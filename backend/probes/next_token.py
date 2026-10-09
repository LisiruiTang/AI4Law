"""
A next-token oracle built on chat models, so the sampling can be ours.

WHY THIS EXISTS. The Simulator's branching walk and strategy comparison used to call
`/v1/completions`, which continues raw text and returns a distribution at each
position. OpenAI retired every model that served it (`gpt-3.5-turbo-instruct`,
`davinci-002` and `babbage-002` all answer "has been deprecated", and the catalogue
holds no base model), and OpenRouter's `/completions` is a chat shim with no base
models either. The endpoint those probes were written against is gone for good.

But neither probe actually needed raw continuation. Both need one thing: given a piece
of text, what are the likely next tokens and how likely is each. Chat models answer
that — `max_tokens=N, logprobs=True, top_logprobs=20` returns a distribution at every
position. The decoding itself was always ours to do. This module is the oracle;
`strategies.py` does the choosing.

────────────────────────────────────────────────────────────────────────────────
THE BOUNDARY PROBLEM, AND THE FRAGMENT BRIDGE THAT SOLVES IT

A chat reply begins at a message boundary, and the leading space of its first token is
not there: ask gpt-4o-mini to continue "After the storm the village was" and position 0
comes back as 'left', never ' left'. Append that verbatim and you get "wasleft". Worse,
the stripping is uniform, so a word-initial token and a mid-word continuation are
indistinguishable — 'array' completing "dis" looks exactly like 'with' starting a new
word.

Three fixes were measured and two failed, which is worth recording because each looks
like it should work.

1. TWO-TOKEN LOOKAHEAD. Request two tokens; position 1 keeps its real space, so whether
   it starts with one tells you a space follows position 0. True, and useless: it
   describes the gap AFTER the committed token, and the gap you need is the one BEFORE
   the next token, which depends on which token you pick. Sample anything other than the
   model's own continuation and the answer no longer applies. Measured output:
   "...left in disarraywith fallen trees".

2. A MARKER PREFIX. Tell the model to emit ">>>" first, so the real text starts at
   position 1 with its spaces intact. It does — but the model also puts a space after
   the marker, every time, including where the text continues a word. Uniformly spaced
   instead of uniformly stripped, which is no more informative. Measured output:
   "...left in dis array".

3. A FRAGMENT BRIDGE. This one works. Any bridge that ENDS a word forces a space after
   it, so the bridge has to end mid-word — and the passage's own final fragment does.
   Tell the model to begin its reply by repeating that fragment verbatim and then carry
   on. The junction is now INSIDE the reply, where boundaries are real, and the fragment
   is discarded: it exists only to put the model past the message edge.

   Measured on gpt-4o-mini: "was" → ' left' (spaced), "dis" → 'array' at 0.999 (not
   spaced), "disarray" → '.' (not spaced). The chain reads "After the storm the village
   was left in disarray. Trees were uprooted, roofs were torn off" with no space handling
   anywhere in this module. Tokens are appended verbatim, which is the only way to be
   sure the spacing is the model's rather than ours.

TEMPERATURE 0, AND WHY IT COSTS NOTHING. The reported logprobs are the pre-temperature
distribution — measured on both providers, see `token_probs.classify`. So temperature
cannot distort the numbers, which frees it to do something useful: at 0 the model's own
continuation IS the greedy path, so every token it returns is the argmax at its
position. One call therefore yields a whole greedy chain with a full distribution at
each step, and any other strategy can keep reading that same response until its choice
leaves the argmax path. `Walk` does exactly that, and it is why a tree costs a handful
of calls rather than one per node.

WHICH MODELS. The bridge needs the model to follow one instruction precisely. Measured:
gpt-4o-mini holds it on OpenAI and through OpenRouter. `mistral-nemo` and
`llama-3.3-70b` do not — they ignore the fragment and simply continue, which is detected
and reported rather than papered over, because the alternative is text with the spaces
in the wrong places and nothing to say so.
"""
import logging
import math
import re

logger = logging.getLogger(__name__)

# 20 is OpenAI's ceiling, and it is generous here: measured captured mass at each step of
# a fourteen-token chain was 0.987-1.000, so the invisible tail is a rounding error
# rather than the structural blind spot it was with the completions endpoint's 5.
TOP_LOGPROBS = 20

# How many positions to ask for in one call. Every position past the bridge is a usable
# step, so this is the reuse budget: larger means fewer round-trips while a strategy
# tracks the argmax, and wasted output tokens when it does not.
LOOKAHEAD = 12

# A fragment longer than this would spend the token budget being echoed. Clipping from
# the LEFT is safe and clipping from the right is not — the right edge is the junction
# that has to line up.
MAX_FRAGMENT = 24


class BridgeError(RuntimeError):
    """The model did not repeat the fragment, so no boundary can be trusted.

    Raised rather than recovered from, on purpose. The fallback would be to read position
    0 and guess the spacing, and a guess that is usually right is the worst outcome
    available: the text reads fine until it does not, and nothing marks which.
    """


def tail_fragment(text: str) -> str:
    """The piece of `text` the model is asked to repeat before continuing."""
    match = re.search(r"\S+$", text)
    fragment = match.group(0) if match else text.strip()[-8:]
    return fragment[-MAX_FRAGMENT:]


def bridge_messages(text: str, fragment: str) -> list[dict]:
    """The prompt. Rigid for the same reason `token_probs.build_messages` is: anything the
    model puts in front of the fragment moves the junction somewhere we cannot find.

    THE FRAGMENT IS STATED TWICE, and that is the whole reason this works. Four wordings
    were measured over twelve awkward mid-walk passages — the shapes a branching search
    actually reaches, not tidy seed prompts:

        fragment stated once, mid-prompt          4/12 lost the bridge
        fragment stated once, as the last line    5/12
        fragment stated once, terser              5/12
        fragment stated twice (this one)          0/12

    Then 0/20 over a wider set, on OpenAI and through OpenRouter. The failure mode being
    bought off is not refusal but omission: the model writes a perfectly good continuation
    and simply does not echo first — asked to resume from "dis" it answers "array. Houses",
    which is the right continuation with no way to locate its boundary.

    Three things learned while getting here, each of which looked like it should help:

      - A LONGER fragment is worse, not better. Three words failed 5/12 and five words
        5/12, against 2/12 for one word: a longer echo is more text to skip past and the
        model treats it as the restating it was told not to do.
      - Recency does not help on its own. Moving the single mention to the last line made
        it worse (5/12 against 4/12).
      - Forbidding a CHARACTER forbids echoing a fragment containing it. An earlier
        version said "no quotation marks"; asked to resume from '"excellent"' the model
        obeyed the formatting rule over the echo and lost the bridge. Every fragment is
        the passage's own text, so the only safe prohibitions are about commentary.

    One consequence to be honest about rather than hide: this instruction is part of the
    conditioning, so the distribution is P(next | passage AND "continue this"), not the
    unconditioned P(next | passage). Compared against the single-mention wording the top
    token was identical on every passage and the ranking almost always was, with tails
    differing by a few tenths of a nat. The footnote in the UI says this.
    """
    return [
        {
            "role": "system",
            "content": (
                "Continue the user's unfinished passage. No explanation, no commentary.\n"
                f"Mandatory format: your reply begins with the characters {fragment!r} "
                "reproduced exactly, then continues straight on with what comes next.\n"
                f"First characters of your reply: {fragment}"
            ),
        },
        {"role": "user", "content": text},
    ]


def _aligned(echoed: str, fragment: str) -> bool:
    """Did the reply open with the fragment?

    Case-insensitive and whitespace-tolerant, because neither affects what the bridge is
    for. A model answering "Was" for "was" has still put itself mid-passage, and the
    fragment is discarded either way — only the boundary after it is used.
    """
    return echoed.strip().lower() == fragment.lower()


class Step:
    """One position: the distribution over what comes next, and what the model took."""

    __slots__ = ("token", "distribution", "argmax")

    def __init__(self, token: str, distribution: list[dict]):
        self.token = token
        self.distribution = distribution
        self.argmax = bool(distribution) and distribution[0]["token"] == token

    def as_dict(self) -> dict:
        return {
            "token": self.token,
            "distribution": self.distribution,
            "argmax": self.argmax,
        }


def _distribution(entry: dict) -> list[dict]:
    """Sorted, because `top_logprobs` order cannot be relied on.

    An OpenRouter upstream was measured prepending the sampled token to the list at
    temperature 2, so `top_logprobs[0]` was not the likeliest token. Everything
    downstream treats rank 0 as the argmax, so that has to be made true rather than
    assumed.
    """
    out = [
        {
            "token": alternative.get("token", ""),
            "logprob": alternative.get("logprob", -99.0),
            "prob": math.exp(alternative.get("logprob", -99.0)),
        }
        for alternative in (entry.get("top_logprobs") or [])
    ]
    out.sort(key=lambda candidate: -candidate["logprob"])
    for rank, candidate in enumerate(out):
        candidate["rank"] = rank
    return out


async def continuation(
    gateway,
    text: str,
    *,
    backend: str = "openai",
    model: str | None = None,
    lookahead: int = LOOKAHEAD,
) -> list[Step]:
    """Distributions for the next `lookahead` positions after `text`.

    Every returned step carries real token boundaries, and at temperature 0 every
    `step.token` is the argmax at its position — so the tokens alone are the greedy
    continuation, and the distributions are what any other strategy needs.
    """
    if not text.strip():
        raise ValueError("Give the model some text to continue.")
    fragment = tail_fragment(text)
    # Room for the fragment to come back in pieces, plus the positions we want. Measured,
    # the fragment arrives as a single token; the slack is for when it does not.
    budget = len(fragment) // 2 + 3 + max(1, lookahead)

    response = await gateway.chat_completion(
        messages=bridge_messages(text, fragment),
        backend=backend,
        model=model,
        max_tokens=budget,
        # Not a style choice, and not free of consequence — see the module docstring.
        # Temperature does not touch the reported logprobs, so 0 buys a greedy reference
        # path at no cost to the numbers.
        temperature=0.0,
        logprobs=True,
        top_logprobs=TOP_LOGPROBS,
    )

    choice = (response.get("choices") or [{}])[0]
    # `or {}` rather than a default: OpenRouter returns an explicit `"logprobs": null`
    # from an upstream that does not support them, and the key being present defeats
    # `.get(k, {})`.
    content = (choice.get("logprobs") or {}).get("content") or []
    if not content:
        named = model or "the provider's default"
        if backend == "openrouter":
            raise RuntimeError(
                f"'{named}' returned no logprobs through OpenRouter. OpenRouter fans a "
                "model across several upstreams and not all of them support logprobs; "
                "the request asks for only those that do, so this usually means no "
                "upstream for this model does. openai/gpt-4o-mini is known to work."
            )
        raise RuntimeError(
            f"Model '{named}' returned no logprobs. Reasoning models (o1, o3) do not "
            "support them — try gpt-4o-mini or gpt-4o."
        )

    echoed, start = "", None
    for index, entry in enumerate(content):
        echoed += entry.get("token", "")
        if len(echoed.strip()) >= len(fragment):
            start = index + 1
            break

    if start is None or not _aligned(echoed, fragment):
        raise BridgeError(
            f"Model '{model or 'the default'}' would not hold the continuation bridge: "
            f"asked to resume from {fragment!r} it replied {echoed.strip()!r}. Without "
            "that the token boundaries cannot be read, so the walk would show text with "
            "the spaces in the wrong places. Try gpt-4o-mini, which holds it on both "
            "providers."
        )

    steps = [Step(entry.get("token", ""), _distribution(entry)) for entry in content[start:]]
    return [step for step in steps if step.distribution]


class Walk:
    """One chain being grown, reusing each response for as long as it stays valid.

    A call returns `lookahead` consecutive distributions, every one of them conditioned
    on the model having taken the argmax at the positions before it. So while a strategy
    happens to choose the argmax too, the next distribution is already in hand; the
    moment it chooses otherwise, the rest of the buffer describes a path nobody is on and
    is dropped.

    This is the same trick as speculative decoding, and it is what makes the cost
    bearable: a greedy chain of twelve tokens is one call, and a tree whose branches
    mostly follow the argmax costs far less than its node count suggests.
    """

    __slots__ = ("gateway", "text", "backend", "model", "lookahead", "_buffer", "calls")

    def __init__(
        self,
        gateway,
        text: str,
        *,
        backend: str = "openai",
        model: str | None = None,
        lookahead: int = LOOKAHEAD,
        buffer: list[Step] | None = None,
    ):
        self.gateway = gateway
        self.text = text
        self.backend = backend
        self.model = model
        self.lookahead = lookahead
        self._buffer = buffer or []
        self.calls = 0

    async def distribution(self) -> list[dict]:
        """What could come next. Empty when the model has nothing to add."""
        if not self._buffer:
            # Counted before the await, not after. Incrementing on the way out undercounts
            # exactly the calls worth knowing about: a request that raised still cost a
            # round-trip and still went on the bill, and a figure that omits the failures
            # makes a struggling walk look cheap.
            self.calls += 1
            self._buffer = await continuation(
                self.gateway,
                self.text,
                backend=self.backend,
                model=self.model,
                lookahead=self.lookahead,
            )
        return self._buffer[0].distribution if self._buffer else []

    def commit(self, token: str) -> None:
        """Extend the chain, keeping the buffer only if we stayed on the argmax path."""
        head = self._buffer[0] if self._buffer else None
        self.text += token
        if head is not None and head.token == token and len(self._buffer) > 1:
            self._buffer = self._buffer[1:]
        else:
            self._buffer = []

    def fork(self, token: str) -> "Walk":
        """A child chain. Inherits the buffer under the same rule `commit` uses.

        The branching walk expands one node into several children and exactly one of them
        is the argmax; that one carries the remaining lookahead with it and costs nothing
        to continue. Its siblings start empty, which is correct — the buffered
        distributions were never conditioned on them.
        """
        head = self._buffer[0] if self._buffer else None
        inherited = (
            self._buffer[1:]
            if head is not None and head.token == token and len(self._buffer) > 1
            else []
        )
        return Walk(
            self.gateway,
            self.text + token,
            backend=self.backend,
            model=self.model,
            lookahead=self.lookahead,
            buffer=inherited,
        )
