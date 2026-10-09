"""
Decoding strategies, implemented here rather than delegated to API parameters.

Until 2026-10-02 this was a mixture and the docstring said so: greedy was
`temperature=0`, nucleus was `top_p=p`, pure sampling was `top_p=1`, and only top-k and
beam were ours, because no API parameter exists for either. That mixture was honest but
it taught the wrong thing. A reader watching nucleus sampling produce different text
learned that the provider has a setting called `top_p`; they did not learn what the
setting DOES, because the part that does it happened on someone else's machine.

Now the model is asked one question — what could come next, and how likely is each —
and every decision after that is in this file, where it can be read. The strategies are
four lines each. That is the point: the mechanism everyone defers to is four lines, and
the difference between a plausible paragraph and a repetitive one is which four.

Each function takes a distribution from `next_token.py` (ranked, with `prob`) and
returns a `Choice` recording not just the token but the pool it was drawn from and how
much mass that pool held. The panels show the pool, because the cut is the strategy —
the draw is just a draw.

THE TAIL WE CANNOT SEE. 20 candidates come back, not the whole vocabulary, so the pools
here are subsets of the true ones. Measured over a fourteen-token chain the 20 carried
0.987-1.000 of the mass, which makes top-k exact for any k <= 20, nucleus exact for any
p at or below the captured mass, and pure sampling a close approximation that is missing
only the part of the tail the model had all but ruled out. With the old completions
endpoint this was 5 candidates and the gap mattered; at 20 it is reported and small.
`captured_mass` travels with every result so a reader can check rather than trust.
"""
import math
import random

# Both are ceilings on what the oracle returns, not on what the maths could do. 20 is
# OpenAI's limit on `top_logprobs`; asking for more would silently get 20.
MAX_K = 20


class Choice:
    """A token, and the reasoning that selected it."""

    __slots__ = ("token", "prob", "renormalised", "pool", "pool_mass", "strategy")

    def __init__(
        self,
        token: str,
        *,
        prob: float,
        renormalised: float,
        pool: list[dict],
        pool_mass: float,
        strategy: str,
    ):
        self.token = token
        # What the model actually assigned it.
        self.prob = prob
        # What it was assigned WITHIN the pool, after the cut. The gap between the two is
        # exactly what truncation does, and it is the number worth looking at: a token at
        # 0.08 of the vocabulary can be at 0.4 of a three-token pool.
        self.renormalised = renormalised
        self.pool = pool
        self.pool_mass = pool_mass
        self.strategy = strategy

    def as_dict(self) -> dict:
        return {
            "token": self.token,
            "prob": self.prob,
            "renormalised": self.renormalised,
            "pool_size": len(self.pool),
            "pool_mass": self.pool_mass,
            "strategy": self.strategy,
        }


def temper(distribution: list[dict], temperature: float) -> list[dict]:
    """Rescale the distribution by temperature: p_i proportional to exp(logprob_i / T).

    This is the operation everyone passes to the provider as a number, done here where it
    can be watched. It is also the operation this codebase got WRONG in prose until
    2026-10-02, and the correction is worth keeping attached to the code that implements
    it: a comment in `token_probs` claimed the API's `temperature` reshapes the logprobs it
    reports, so that `temperature=0` would return a one-hot distribution. Measured, it does
    not — the reported logprobs are the PRE-temperature distribution, on both providers,
    unchanged from 0 to 2.

    That measurement is what makes this function possible rather than redundant. Because
    the numbers come back untempered, the temperature applied to them is entirely ours, and
    a reader can see the same distribution at T=0.5 and T=1.5 and watch the sharpening
    happen rather than infer it from different output text.

    T <= 0 means argmax, which is the limit as T approaches 0 and avoids dividing by zero.

    One honesty note. Applying this to the visible 20 is not identical to applying it to the
    full vocabulary, and the gap grows with T: raising temperature moves mass toward the
    tail, and part of that tail is not here to receive it. At T > 1 the result is therefore
    slightly sharper than the true tempered distribution. `captured_mass` is the measure of
    how much that can matter.
    """
    if temperature <= 0:
        head = max(distribution, key=lambda c: c["logprob"])
        return [{**head, "prob": 1.0, "logprob": 0.0, "rank": 0}]
    # Subtract the max before exponentiating. The logprobs are all negative and dividing by
    # a small T makes them large and negative, which underflows to a row of zeros and a
    # zero-weight pool; shifting makes the largest exactly 1 and loses nothing, because the
    # normalisation divides the shift back out.
    top = max(c["logprob"] for c in distribution)
    weights = [math.exp((c["logprob"] - top) / temperature) for c in distribution]
    total = sum(weights)
    if total <= 0:
        return distribution
    out = [
        {**c, "prob": w / total, "logprob": math.log(w / total) if w > 0 else -99.0}
        for c, w in zip(distribution, weights)
    ]
    out.sort(key=lambda c: -c["logprob"])
    for rank, candidate in enumerate(out):
        candidate["rank"] = rank
    return out


def entropy(distribution: list[dict]) -> float:
    """Shannon entropy in bits over the visible candidates.

    Worth displaying beside every step, because it is what decides whether a prompt makes
    an interesting demonstration. Measured: "My favourite colour is" runs at 0.003 bits —
    the model is certain, every strategy produces "blue", and the comparison shows
    nothing. "The student submitted an essay that" runs at 2.076 bits and the strategies
    visibly disagree. A prompt is not a detail of this probe; it is the experiment.
    """
    return -sum(c["prob"] * math.log2(c["prob"]) for c in distribution if c["prob"] > 0)


def captured_mass(distribution: list[dict]) -> float:
    """How much of the true distribution the visible candidates account for."""
    return sum(c["prob"] for c in distribution)


def _draw(pool: list[dict], rng: random.Random, strategy: str) -> Choice:
    """Sample one token from `pool` in proportion to probability, renormalised.

    Renormalisation is the whole of truncated sampling. Cutting the vocabulary leaves the
    survivors' probabilities summing to less than one, and sampling then requires
    dividing through by what survived — which inflates every survivor. Doing it here, in
    one place, is what lets top-k and nucleus differ only in how they choose the pool.
    """
    mass = sum(c["prob"] for c in pool)
    if mass <= 0:
        # Degenerate, and only reachable if every visible candidate came back at zero.
        # Fall back to the ranked first rather than raising inside a long walk.
        head = pool[0]
        return Choice(
            head["token"], prob=head["prob"], renormalised=1.0, pool=pool,
            pool_mass=0.0, strategy=strategy,
        )
    pick = rng.choices(pool, weights=[c["prob"] for c in pool], k=1)[0]
    return Choice(
        pick["token"],
        prob=pick["prob"],
        renormalised=pick["prob"] / mass,
        pool=pool,
        pool_mass=mass,
        strategy=strategy,
    )


def greedy(distribution: list[dict], rng: random.Random | None = None) -> Choice:
    """The likeliest token, always. No randomness, so `rng` is accepted and ignored.

    The pool is one token wide, which is the honest way to draw it: greedy is not a mild
    version of sampling, it is sampling from a pool of size one.
    """
    head = distribution[0]
    return Choice(
        head["token"],
        prob=head["prob"],
        renormalised=1.0,
        pool=[head],
        pool_mass=head["prob"],
        strategy="greedy",
    )


def top_k(distribution: list[dict], k: int, rng: random.Random) -> Choice:
    """Keep the k likeliest, renormalise, sample.

    A FIXED cut, which is the complaint against it: the same k is applied whether the
    model has one plausible continuation or fifty. Where the distribution is sharp, k=5
    reaches into tokens the model had effectively dismissed; where it is flat, k=5 throws
    away continuations that were live. Nucleus sampling exists because of this.
    """
    pool = distribution[: max(1, min(int(k), MAX_K))]
    return _draw(pool, rng, "top_k")


def top_p(distribution: list[dict], p: float, rng: random.Random) -> Choice:
    """Keep the smallest set of likeliest tokens whose mass reaches p, renormalise, sample.

    The cut MOVES with the model's confidence, which is the argument for it. At 0.9: a
    step where the top token holds 0.95 gives a pool of one, and a step spread across
    twenty gives a pool of twelve. The same parameter, a different number of candidates,
    decided by the distribution rather than by us.

    The set includes the token that crosses p rather than stopping below it, so the pool
    always holds at least p of the mass — and so a pool is never empty, which a strict
    reading of "reaches p" would allow when the top token alone exceeds p.
    """
    threshold = min(max(float(p), 0.0), 1.0)
    pool: list[dict] = []
    running = 0.0
    for candidate in distribution:
        pool.append(candidate)
        running += candidate["prob"]
        if running >= threshold:
            break
    return _draw(pool, rng, "top_p")


def pure(distribution: list[dict], rng: random.Random) -> Choice:
    """Sample the whole (visible) distribution, tail included, no truncation.

    The baseline the other three are corrections to. Every candidate the oracle returned
    is eligible in proportion to its probability, including the ones at 0.0001 — and it is
    those that produce the occasional sentence that derails, which is the demonstration.

    "Visible" is doing work in that first line: this is the one strategy where the missing
    tail matters in principle, since the tokens we cannot see are exactly the ones pure
    sampling is distinguished by being willing to draw. At a captured mass of 0.99 the
    omission is 1% of draws and it is reported, not hidden.
    """
    return _draw(list(distribution), rng, "pure")


# Beam search is deliberately not in this file. It is not a per-step rule — it needs several
# chains alive at once and scores whole sequences — so it cannot be expressed as a function
# from one distribution to one token. It lives in `beam_search.py`, and the fact that it does
# not fit here is part of what distinguishes it.
