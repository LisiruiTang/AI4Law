"""
Token-probability probe: read the model's distribution over a set of labels instead
of the single word it happened to sample.

Adapted from the TokenProbs approach (github.com/francescoafabozzi/TokenProbs), which
loads a HuggingFace model and reads raw logits at the answer position. We call hosted
APIs and cannot touch logits, so we use the API equivalent: constrain the answer to a
single token, request the top-k alternatives at that position with their logprobs, and
renormalize over the labels the user asked about.

Two consequences of working through an API rather than local logits, both surfaced to
the caller rather than hidden:

1. Only the top-k alternatives come back (k <= 20 for OpenAI). A label whose first
   token falls outside that window reads as probability zero. `captured_mass` reports
   how much of the raw distribution the labels actually accounted for, so a user can
   tell "the model is certain" from "we could not see the answer".
2. Labels are matched on their FIRST token, because that is the only position we
   constrain. "partly" and "partial" share a first token and would be indistinguishable;
   the caller is warned when two labels collide.

TWO PROVIDERS, BOTH PINNED. OpenAI and OpenRouter return logprobs; Anthropic's API
returns none at all, so a Claude key cannot answer this question and the route says
so rather than silently substituting a sampled answer. Which of the two runs is
decided by the caller from the keys on the request — see `capabilities.py`.

OpenRouter was added so a reader can use this on their own key without an OpenAI
account. It needs one thing OpenAI does not: the request must ask OpenRouter to route
only to upstreams that honour logprobs, because it fans each model out across several
and they do not all support them. Without that the same request returns numbers on
one call and nulls on the next. See `LLMGateway._call_openrouter`.
"""
import logging
import math
import re

logger = logging.getLogger(__name__)

# OpenAI's ceiling. More alternatives means a better chance of catching every label
# and a more honest captured_mass.
TOP_LOGPROBS = 20
DEFAULT_MODEL = "gpt-4o-mini"


def _norm(token: str) -> str:
    """Compare tokens ignoring the leading space and case that tokenizers add."""
    return token.strip().lower()


def _first_token_key(label: str) -> str:
    """The prefix a single generated token could match for this label.

    We do not know the model's tokenizer, so instead of predicting the split we
    compare loosely: a returned token matches a label if either is a prefix of the
    other, after normalisation.
    """
    return _norm(label)


def _match(token: str, label: str) -> bool:
    t, l = _norm(token), _first_token_key(label)
    if not t or not l:
        return False
    return l.startswith(t) or t.startswith(l)


def build_messages(text: str, labels: list[str], instruction: str | None) -> list[dict]:
    """The prompt is deliberately rigid: any preamble would put the label somewhere
    other than the first token, and the first token is the only one we can read."""
    options = " / ".join(labels)
    system = (
        (instruction.strip() + "\n\n" if instruction and instruction.strip() else "")
        + f"Answer with exactly one word, chosen from: {options}. "
        "Output only that word. No punctuation, no explanation, no preamble."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": text},
    ]


async def classify(
    gateway,
    *,
    text: str,
    labels: list[str],
    instruction: str | None = None,
    model: str | None = None,
    backend: str = "openai",
) -> dict:
    """Return the model's distribution over `labels` for `text`.

    `backend` is `openai` or `openrouter` — the two providers that return logprobs.
    Still pinned, just no longer pinned to one name: an unpinned call falls through to
    `settings.llm_backend` and hands an OpenAI model id to whatever that happens to
    be, which is how this probe once sent `gpt-4o-mini` to Anthropic and got a 404.
    The caller resolves which of the two, because that depends on the keys on the
    request, not on anything this module can see.
    """
    labels = [l.strip() for l in labels if l and l.strip()]
    if len(labels) < 2:
        raise ValueError("Give at least two labels to choose between.")

    # The default model differs per provider, so it cannot be a module constant any
    # more. None means "the provider's configured default", which the gateway fills.
    if not model and backend == "openai":
        model = DEFAULT_MODEL
    resp = await gateway.chat_completion(
        messages=build_messages(text, labels, instruction),
        backend=backend,
        model=model,
        max_tokens=1,
        # 1.0 — and the reason written here until 2026-10-02 was wrong, which matters
        # because it was the kind of wrong somebody would act on.
        #
        # It said temperature scales the logits before the softmax, so temperature=0
        # would return a one-hot distribution. MEASURED, it does not: the reported
        # logprobs are the PRE-temperature distribution, on both providers. Four runs
        # each on OpenAI gave a top probability of 0.816 / 0.812 / 0.792 at
        # temperature 0 / 1 / 2 — no trend, only run-to-run jitter. On OpenRouter the
        # same token came back at 0.8204 at temperature 0 and 0.8204 at temperature 2.
        #
        # So the numbers this probe displays would be identical at any temperature,
        # and the setting cannot distort them. What temperature DOES change is which
        # token gets sampled — and that is the real reason to keep it at 1.0, because
        # `sampled` is returned alongside the distribution as "the word it actually
        # said". At 0 that is always the argmax, which makes the distribution look
        # decorative; at 2 it is noise. At 1.0 it is an honest draw from the
        # distribution shown beside it, so the two agree about the same model.
        #
        # One provider-specific hazard found while measuring this: at temperature 2 an
        # OpenRouter upstream PREPENDED the sampled token to `top_logprobs`
        # ('cipe' at ~0.0000 ahead of 'Sun' at 0.8204), displacing a real alternative.
        # The label matching below sums over entries rather than trusting their order,
        # so it is unaffected — but anything here that assumed `top_logprobs[0]` is the
        # most likely token would be silently wrong.
        temperature=1.0,
        logprobs=True,
        top_logprobs=TOP_LOGPROBS,
    )

    choice = (resp.get("choices") or [{}])[0]
    # `.get("logprobs")` can be an explicit null rather than absent — OpenRouter
    # returns `"logprobs": null` from an upstream that does not support them, and
    # `{}.get(k, {})` would not help because the key IS there. Hence `or {}`.
    content = (choice.get("logprobs") or {}).get("content") or []
    if not content:
        named = model or "the provider's default"
        if backend == "openrouter":
            raise RuntimeError(
                f"'{named}' returned no logprobs through OpenRouter. OpenRouter fans a "
                "model across several upstreams and not all of them support logprobs; "
                "the request asks for only those that do, so this usually means no "
                "upstream for this model does. Try another model — "
                "mistralai/mistral-nemo is known to work."
            )
        raise RuntimeError(
            f"Model '{named}' returned no logprobs. Reasoning models (o1, o3) do not "
            "support them — try gpt-4o-mini or gpt-4o."
        )

    # Position 0 only: that is where the label lands.
    alternatives = content[0].get("top_logprobs") or []
    raw = [
        {"token": a.get("token", ""), "prob": math.exp(a.get("logprob", -99))}
        for a in alternatives
    ]

    scores: dict[str, float] = {label: 0.0 for label in labels}
    for entry in raw:
        for label in labels:
            if _match(entry["token"], label):
                # Sum rather than assign: several returned tokens ("Yes", " yes")
                # can map to the same label.
                scores[label] += entry["prob"]
                break

    captured = sum(scores.values())
    if captured > 0:
        distribution = {k: v / captured for k, v in scores.items()}
    else:
        distribution = {k: 0.0 for k in labels}

    # Labels where one is a prefix of the other cannot be told apart from a single
    # token: a returned "part" matches both "partly" and "partial", and the loop above
    # awards it to whichever came first. Report it rather than quietly picking one.
    collisions = [
        [a, b]
        for i, a in enumerate(labels)
        for b in labels[i + 1 :]
        if _match(a, b)
    ]

    return {
        # What the PROVIDER says it ran, falling back to what we asked for.
        #
        # `model` alone was None whenever the caller named none and the gateway filled
        # the default — so the panel displayed an empty model, and the reasoning
        # check's "both halves ran on the same model" became a comparison of two
        # Nones, which is true and worthless. Reading it back is also more honest on
        # OpenRouter, which may serve a dated variant of the id it was asked for.
        "model": resp.get("model") or model,
        "sampled": (choice.get("message") or {}).get("content", "").strip(),
        "distribution": distribution,
        # The unnormalised top-k as returned, so the mechanism is visible rather than
        # just its tidy output.
        "raw_top_tokens": sorted(raw, key=lambda r: -r["prob"])[:10],
        "captured_mass": captured,
        "collisions": collisions,
    }


async def compare(
    gateway,
    *,
    text: str,
    labels: list[str],
    block_text: str = "",
    block_text_b: str | None = None,
    instruction: str | None = None,
    model: str | None = None,
    model_b: str | None = None,
    backend: str = "openai",
) -> dict:
    """Run the same classification under two conditions that differ in ONE way.

    Three shapes, and which one you get depends on what you supply:

    `block_text` alone — presence versus absence. The measurement the Sandbox and
    Arena approximate with an LLM judge.

    `block_text` and `block_text_b` — version A against version B, which is what you
    want when a rule has been amended: the same facts judged under the old text and
    the new one, nothing else changed. Absence is not the interesting counterfactual
    there; the superseded text is.

    `model_b` — the context is held constant (present in both arms, or absent from
    both) and the MODEL is the variable. Choosing a model is a design decision that
    usually gets made on price and habit, and this is the one place a faculty member
    can see what it costs them on their own question.

    ONE VARIABLE, ENFORCED HERE RATHER THAN TRUSTED TO THE UI. A run that changed the
    context and the model together would produce a number that cannot be attributed to
    either, and it would look exactly like a run that meant something.
    """
    models_mode = bool(model_b and model_b.strip() and model_b.strip() != (model or "").strip())
    if models_mode and block_text_b and block_text_b.strip():
        raise ValueError(
            "Compare two models or two contexts, not both at once — with both changing, "
            "the movement cannot be attributed to either."
        )
    if not models_mode and not (block_text or "").strip():
        raise ValueError("Provide the context to switch on and off.")

    base = (instruction or "").strip()
    block = (block_text or "").strip()
    versions = bool(block_text_b and block_text_b.strip())

    if models_mode:
        # Held constant across both arms by construction: the same string is passed
        # to each. If a context was supplied it applies to both, so the only thing
        # that differs is which model answered.
        shared = (base + "\n" + block).strip() if block else (base or None)
        on = await classify(
            gateway, text=text, labels=labels, instruction=shared, model=model, backend=backend
        )
        off = await classify(
            gateway, text=text, labels=labels, instruction=shared, model=model_b, backend=backend
        )
        deltas = {
            label: on["distribution"].get(label, 0.0) - off["distribution"].get(label, 0.0)
            for label in on["distribution"]
        }
        return {
            "on": on,
            "off": off,
            "deltas": deltas,
            "shift": sum(abs(d) for d in deltas.values()) / 2,
            "block_text": block or None,
            "block_text_b": None,
            "mode": "models",
            "model_a": on.get("model"),
            "model_b": off.get("model"),
        }

    with_block = (base + "\n" + block).strip()
    alternative = (
        (base + "\n" + block_text_b.strip()).strip() if versions else (base or None)
    )

    on = await classify(
        gateway, text=text, labels=labels, instruction=with_block, model=model, backend=backend
    )
    off = await classify(
        gateway, text=text, labels=labels, instruction=alternative, model=model, backend=backend
    )

    deltas = {
        label: on["distribution"].get(label, 0.0) - off["distribution"].get(label, 0.0)
        for label in on["distribution"]
    }
    # Total variation distance: half the summed absolute shift, so 0 means the block
    # changed nothing and 1 means it moved every bit of mass.
    shift = sum(abs(d) for d in deltas.values()) / 2

    return {
        "on": on,
        "off": off,
        "deltas": deltas,
        "shift": shift,
        "block_text": block_text.strip(),
        "block_text_b": (block_text_b or "").strip() or None,
        # "presence" = with the instruction vs without it.
        # "versions" = under text A vs under text B, nothing else changed.
        "mode": "versions" if versions else "presence",
    }
