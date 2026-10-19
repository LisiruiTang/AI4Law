"""
Top-K branching search over next-token distributions.

The point this exists to make: greedy decoding takes the most likely token at every
step, but the most likely SEQUENCE often does not start with the most likely token. A
branch that opens at 12% can end up carrying more total probability than one that opened
at 70%, because of what each makes possible downstream. That is the entire motivation for
beam search, and it is much easier to see than to be told.

Each step expands every surviving chain into its top K continuations, scores the children
by cumulative log-probability, and keeps the best `beam_width`. Pruned branches are kept
in the returned tree, marked, so the visualisation can show what was discarded rather
than silently dropping it.

REBUILT 2026-10-02 ON A CHAT ORACLE. This used to call `/v1/completions`, and that
endpoint no longer exists at any provider — see `next_token.py` for what was retired and
what replaced it. Nothing about the search changed; only where the distributions come
from. Two things got better in the move:

  - K can exceed 5. The completions endpoint returned exactly five candidates and `MAX_K`
    was pinned to that ceiling. Chat logprobs return twenty, so the branching factor is
    now a design choice rather than a provider limit.
  - The cost is no longer one call per node. At temperature 0 a single response carries a
    whole argmax path with a distribution at every position, and `Walk.fork` hands the
    remainder to whichever child continued it — so the greedy spine of the tree is
    essentially free and only the branches off it pay. `calls` in the result is measured,
    not derived from a formula, because the saving depends on the prompt.
"""
import asyncio
import logging
import math

from probes.next_token import LOOKAHEAD, BridgeError, Step, Walk
from probes.strategies import captured_mass, entropy, temper

logger = logging.getLogger(__name__)

# Whichever provider is serving logprobs decides the real default; the route resolves it
# from the keys on the request. This is the OpenAI name because that is the one that has
# been measured to hold the continuation bridge at every step of a deep walk.
DEFAULT_MODEL = "gpt-4o-mini"
MAX_DEPTH = 8
# Twenty is what the oracle returns, but a tree of width 20 is unreadable long before it
# is unaffordable. This is a legibility ceiling, not a provider one.
MAX_K = 10
MAX_BEAM = 16
# The shortest chain allowed to win when the caller names no floor. See `beam_search` for
# the trade-off this sets; the frontend keeps a matching constant.
DEFAULT_MIN_LENGTH = 2


def _per_token(node: dict) -> float:
    """Mean log-probability per token — the log of the geometric mean.

    The ranking score. Comparing chains on `cum_logprob` compares a short chain's product
    of three probabilities with a long one's product of eight, which the shorter wins
    almost by arithmetic; dividing by the length removes the term that only counts steps.
    """
    return node["cum_logprob"] / max(node["step"], 1)


async def _expand(walk: Walk, k: int, *, first_call: bool,
                  temperature: float = 1.0, top_p: float = 0.9) -> dict:
    """Top-k candidate next tokens for one chain, with the step's summary statistics.

    `candidates` is empty when the model has nothing to add — a chain that has run to a
    natural end. That is an ordinary outcome for one branch among many, so it makes the
    branch terminal rather than failing the whole search. Only the very first call treats
    it as fatal, because there it means the model cannot do this at all.

    Temperature is applied over the returned candidates, then top-p and top-k
    filter them. Displayed and scored probabilities are normalized over that pool.
    Captured mass still describes the original model-reported candidates.
    """
    empty = {"candidates": [], "entropy": 0.0, "captured": 0.0, "bridge_lost": False}
    try:
        distribution = await walk.distribution()
    except BridgeError:
        if first_call:
            raise
        # One branch hit a fragment the model would not echo. Ending that branch is the
        # proportionate response; the count is reported so it is not invisible.
        logger.info("Bridge lost mid-walk after %r", walk.text[-80:])
        return {**empty, "bridge_lost": True}
    if not distribution:
        logger.info("Chain ended (no continuation) after %r", walk.text[-80:])
        return empty
    shaped = temper(distribution, temperature)
    nucleus = []
    cumulative = 0.0
    for candidate in shaped:
        if candidate["prob"] <= 0:
            continue
        nucleus.append(candidate)
        cumulative += candidate["prob"]
        if cumulative >= top_p:
            break
    pool = nucleus[:k]
    mass = sum(candidate["prob"] for candidate in pool)
    candidates = [
        {**candidate, "prob": candidate["prob"] / mass,
         "logprob": math.log(candidate["prob"] / mass), "rank": rank}
        for rank, candidate in enumerate(pool)
    ]
    return {
        "candidates": candidates,
        "entropy": entropy(candidates),
        "captured": captured_mass(distribution),
        "bridge_lost": False,
    }


async def beam_search(
    gateway,
    *,
    prompt: str,
    k: int = 3,
    temperature: float = 1.0,
    top_p: float = 0.9,
    depth: int = 6,
    beam_width: int = 10,
    min_length: int | None = None,
    model: str | None = None,
    backend: str = "openai",
    distribution_cache: dict[str, list[Step]] | None = None,
) -> dict:
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("Give the model some text to continue.")
    k = max(2, min(int(k), MAX_K))
    if not math.isfinite(temperature) or not 0 < temperature <= 2:
        raise ValueError("Temperature must be greater than 0 and at most 2.")
    if not math.isfinite(top_p) or not 0 < top_p <= 1:
        raise ValueError("Top-p must be greater than 0 and at most 1.")
    depth = max(1, min(int(depth), MAX_DEPTH))
    beam_width = max(2, min(int(beam_width), MAX_BEAM))
    # The shortest chain allowed to win. A CONTROL rather than a constant, because the
    # trade-off it sets has no right answer and is itself the thing worth seeing.
    #
    # Per-token scoring lets a chain that stops early win, which is correct when the text
    # has one obvious completion — and it has a bias: every further token multiplies in a
    # probability below 1, so the measure would rather stop than commit. Left unchecked the
    # winner is usually the greedy chain truncated, which is a true statement about
    # probability and a dull one about language.
    #
    # Measured over seven prompts at the default depth, the floor trades one lesson for the
    # other and cannot give both:
    #
    #   floor 1   forks headline on 1 of 7; "Two plus two equals" wins with " four" (1.000)
    #   floor 2   forks headline on 1 of 7; wins with " four." (1.000)
    #   floor 3   forks headline on 4 of 7; wins with " four. However," (0.778)
    #
    # The conflict is structural, not a tuning problem: " four" IS a prefix of the greedy
    # chain, so any floor above 1 excludes exactly the case the floor was wanted for. Hence
    # a slider.
    #
    # DEFAULT 2, which takes the short-answer side of that trade. It was depth // 2 for one
    # commit, and at the default depth of 6 that is 3 — the value where " four" stops
    # winning. Two keeps it (" four." scores 1.000, and a full stop is arguably the better
    # answer anyway) while still excluding the degenerate case a floor exists to exclude: a
    # single token that wins only because one token cannot be marked down. It is a constant
    # rather than a function of depth so that lengthening the walk does not silently raise
    # the bar on what counts as an answer.
    floor = DEFAULT_MIN_LENGTH if min_length is None else int(min_length)
    floor = max(1, min(floor, depth))
    if not model and backend == "openai":
        model = DEFAULT_MODEL

    root_walk = Walk(
        gateway, prompt, backend=backend, model=model, lookahead=max(depth, LOOKAHEAD),
        cache=distribution_cache,
    )
    root = {
        "id": 0,
        "parent": None,
        "step": 0,
        "token": "",
        "text": "",
        "logprob": 0.0,
        "prob": 1.0,
        "cum_logprob": 0.0,
        "cum_prob": 1.0,
        "rank": 0,
        "pruned": False,
        "on_greedy": True,
        "terminal": False,
    }
    nodes: list[dict] = [root]
    walks: dict[int, Walk] = {0: root_walk}
    frontier = [root]
    greedy_id = 0
    next_id = 1
    calls = 0
    bridge_failures = 0

    for step in range(1, depth + 1):
        if not frontier:
            break
        try:
            expansions = await asyncio.gather(
                *(
                    _expand(walks[n["id"]], k, first_call=(step == 1),
                            temperature=temperature, top_p=top_p)
                    for n in frontier
                )
            )
        except Exception:
            logger.exception("Beam expansion failed at step %d", step)
            raise
        calls += sum(walks[n["id"]].calls for n in frontier)

        children: list[dict] = []
        for parent, expansion in zip(frontier, expansions):
            # Taken out of the map as soon as it is read. The parent has been expanded and
            # will never be asked again, and `parent_walk` keeps the reference this loop
            # needs — including on the `continue` below, which a pop at the end would miss.
            parent_walk = walks.pop(parent["id"])
            if expansion["bridge_lost"]:
                bridge_failures += 1
            if not expansion["candidates"]:
                # This chain has run out; it stays as a finished leaf and simply stops
                # competing for beam slots.
                parent["terminal"] = True
                continue
            # Recorded per expansion rather than per node: the same distribution serves
            # every child, so these describe the PARENT's step, and the panel reads them
            # off whichever child it is drawing.
            step_entropy = expansion["entropy"]
            step_captured = expansion["captured"]
            for cand in expansion["candidates"]:
                child = {
                    "id": next_id,
                    "parent": parent["id"],
                    "step": step,
                    "token": cand["token"],
                    "text": parent["text"] + cand["token"],
                    "logprob": cand["logprob"],
                    "prob": cand["prob"],
                    "cum_logprob": parent["cum_logprob"] + cand["logprob"],
                    "cum_prob": math.exp(parent["cum_logprob"] + cand["logprob"]),
                    "rank": cand["rank"],
                    "pruned": False,
                    "terminal": False,
                    # How undecided the model was at the point this child branched off.
                    # Available now that the oracle returns the whole distribution rather
                    # than just the top K, and it is the number that says whether a branch
                    # point was a real fork or a formality.
                    "entropy": step_entropy,
                    "captured_mass": step_captured,
                    # Greedy = always the rank-0 child of the greedy node, which is a
                    # different rule from "best cumulative score".
                    "on_greedy": parent["id"] == greedy_id and cand["rank"] == 0,
                }
                next_id += 1
                children.append(child)
                nodes.append(child)
                # Exactly one child per parent inherits the buffered lookahead — the one
                # that took the argmax. The others start cold, correctly: those buffered
                # distributions were never conditioned on them.
                walks[child["id"]] = parent_walk.fork(cand["token"])

        new_greedy = next((c for c in children if c["on_greedy"]), None)
        if new_greedy:
            greedy_id = new_greedy["id"]

        ranked = sorted(children, key=lambda c: -c["cum_logprob"])
        survivors = ranked[:beam_width]
        # Keep the greedy chain alive even when the beam would drop it — the whole
        # comparison depends on being able to follow it to the end.
        if new_greedy and new_greedy not in survivors:
            survivors = survivors[: beam_width - 1] + [new_greedy]
        survivor_ids = {c["id"] for c in survivors}
        for c in children:
            if c["id"] not in survivor_ids:
                c["pruned"] = True
        # Walks for pruned children will never be asked for a distribution, and holding
        # them would keep a buffer per discarded node for the life of the search.
        for c in children:
            if c["id"] not in survivor_ids:
                walks.pop(c["id"], None)
        frontier = survivors

    # RANKED PER TOKEN, and every surviving chain competes whatever its length.
    #
    # Cumulative probability is a product over tokens, so it falls with every step and a
    # short chain almost always "wins" on it. This used to be handled by refusing the
    # comparison — rank only full-depth chains, so lengths match — which kept the
    # beam-search point clean and had a cost: a chain that stops early can be a complete
    # and correct answer. "Two plus two equals" continues as " four" at 0.99999, and
    # nothing longer is better; under the old rule that chain could never win.
    #
    # So the score is the per-token geometric mean, exp(cum_logprob / steps), and the
    # length restriction is gone. A one-token chain now beats an eight-token one exactly
    # when it deserves to: " four" averages 0.99999, while on "The student submitted an
    # essay that" the eight-token " demonstrated a deep understanding of the subject
    # matter" averages 0.73 and beats " was" at 0.32. Gibberish is punished by the same
    # measure, since gibberish has low per-token probability. What this rule is weak
    # against is long BLAND chains — a run of near-certain function words scores well.
    #
    # Measured alternative, rejected: normalising within a length class, prob divided by
    # the summed probability of all chains at the same step. That denominator is the mass
    # the BEAM still holds at that depth, so it corrects for what the search discarded
    # rather than for length — it is exactly 1.0000 at the first two steps of a sharp
    # prompt, applying no correction at all there, and in the limit of an exhaustive
    # search it reduces to raw cumulative probability. It also moves the winner when
    # beam_width changes (' explored the' at 6, ' was' at 10 and 16), which makes the
    # score a property of the search rather than of the text.
    # `or` rather than an unconditional filter: if nothing reached the floor — every chain
    # lost its bridge early, say — ranking an empty pool would report the root as the
    # winner, which is a blank answer dressed as a result.
    eligible = [n for n in nodes if not n["pruned"] and n["step"] >= floor]
    leaves = eligible or [n for n in nodes if not n["pruned"] and n["step"] > 0]
    best = max(leaves, key=_per_token) if leaves else root
    greedy = next((n for n in nodes if n["id"] == greedy_id), root)

    def chain(node: dict) -> list[dict]:
        by_id = {n["id"]: n for n in nodes}
        out: list[dict] = []
        cur: dict | None = node
        while cur is not None and cur["id"] != 0:
            out.append(cur)
            cur = by_id.get(cur["parent"])
        return list(reversed(out))

    best_chain = chain(best)
    greedy_chain = chain(greedy)

    # THREE RELATIONSHIPS, not two, once chains of different lengths can win.
    #
    # Under the old same-length rule the two chains either matched or forked, and a single
    # divergence step described it. Now the winner can be a PREFIX of the greedy chain —
    # "The capital of France is" continues as " Paris" at 0.9996, and that one token
    # averages better than greedy's eight. Such a pair never parts company: one simply
    # stops earlier. Reporting a divergence step for it would name a step at which nothing
    # happened, and reporting none while `diverged` is true reads as a bug.
    best_ids = [n["id"] for n in best_chain]
    greedy_ids = [n["id"] for n in greedy_chain]
    shorter, longer = sorted((best_ids, greedy_ids), key=len)
    is_prefix = longer[: len(shorter)] == shorter

    divergence_step = None
    if not is_prefix:
        for a, b in zip(best_chain, greedy_chain):
            if a["id"] != b["id"]:
                divergence_step = a["step"]
                break

    relation = (
        "same"
        if best["id"] == greedy["id"]
        else "prefix" if is_prefix else "diverged"
    )

    return {
        "model": model,
        "backend": backend,
        "prompt": prompt,
        "k": k,
        "temperature": temperature,
        "top_p": top_p,
        "depth": depth,
        "beam_width": beam_width,
        "min_length": floor,
        # Whether the floor actually bound anything, so the panel can say "a shorter chain
        # scored better but was not eligible" rather than leaving a reader to wonder why an
        # obvious short answer did not win.
        "min_length_binding": bool(
            eligible
            and max(
                (n for n in nodes if not n["pruned"] and n["step"] > 0),
                key=_per_token,
                default=root,
            )["step"]
            < floor
        ),
        "nodes": nodes,
        "best": {
            "text": best["text"],
            "cum_prob": best["cum_prob"],
            "cum_logprob": best["cum_logprob"],
            # Per-token geometric mean, so chains of different lengths stay comparable.
            "avg_prob": math.exp(best["cum_logprob"] / max(best["step"], 1)),
            "ids": [n["id"] for n in best_chain],
        },
        "greedy": {
            "text": greedy["text"],
            "cum_prob": greedy["cum_prob"],
            "cum_logprob": greedy["cum_logprob"],
            "avg_prob": math.exp(greedy["cum_logprob"] / max(greedy["step"], 1)),
            "ids": [n["id"] for n in greedy_chain],
        },
        "diverged": best["id"] != greedy["id"],
        "divergence_step": divergence_step,
        # Probability ratio between the two chains. Only meaningful when they are the same
        # length; when they are not, fall back to the per-token ratio so the figure never
        # overstates a short chain's advantage.
        # ALWAYS per token, because that is the measure the two were ranked on. It used
        # to be the total ratio when lengths matched and the per-token ratio when they did
        # not, which meant the headline figure silently changed units; with chains of any
        # length competing it would change units on most runs.
        "advantage": (
            1.0
            if best["id"] == greedy["id"]
            else math.exp(_per_token(best) - _per_token(greedy))
        ),
        "same_length": best["step"] == greedy["step"],
        # "same" | "prefix" | "diverged" — see where it is computed. `prefix` is new and
        # is the common shape on a prompt with one obvious completion.
        "relation": relation,
        # Measured, not computed from the node count. The old formula
        # `1 + K + beam_width * (depth - 2)` was exact because every node cost a call;
        # with lookahead reuse the figure depends on how much of the tree followed the
        # model's own argmax path, which only the search knows.
        "calls": calls,
        "bridge_failures": bridge_failures,
    }


async def beam_variations(gateway, *, prompt: str, k: int = 3, depth: int = 6,
                          beam_width: int = 10, min_length: int = 2,
                          model: str | None = None, backend: str = "openai") -> dict:
    """Three settings with one request-local baseline cache; no cross-user state.

    Medium is evaluated first. Later searches fetch only previously unseen prefixes.
    All three results are returned together so switching settings costs no API calls.
    """
    cache: dict[str, list[Step]] = {}
    results = {}
    for label, temperature in (("medium", 1.0), ("low", 0.2), ("high", 1.8)):
        results[label] = await beam_search(
            gateway, prompt=prompt, k=k, temperature=temperature, top_p=0.9,
            depth=depth, beam_width=beam_width, min_length=min_length,
            model=model, backend=backend, distribution_cache=cache,
        )
    return {"variations": results, "calls": sum(r["calls"] for r in results.values())}
