"""
Short names for the two arms of a comparison.

WHY A MODEL, AND WHY IT IS ONLY A SUGGESTION.

The two arms need labels because "Context on" and "Context off" say nothing about what
actually differs, and the results panel puts those words beside the bars where they
are the reader's only cue. But naming two long paragraphs by what separates them is a
reading, not a computation — so a model proposes and a person edits, which is the same
arrangement saved-search naming already uses.

`source` comes back with the names, "model" or "fallback", so the panel can say where
they came from. Presenting a suggestion as though the person chose it would be a small
lie, and this library runs on telling those apart.

WHAT THE PROMPT ASKS FOR, AND WHY IT MATTERS. Names that DISTINGUISH. Two accurate
labels that are both "Grading rubric" leave the reader worse off than A and B, because
they look informative and are not.
"""
import json
import logging
import re

logger = logging.getLogger(__name__)

FALLBACK = ("Context A", "Context B")

_PROMPT = """Two versions of an instruction are being compared, on identical input.
Name each one so a reader can tell them apart at a glance.

Rules:
- 2 to 4 words each. They sit under a bar chart, so they must be short.
- Name what DISTINGUISHES them. If both names would say the same thing, you have not
  read far enough into the difference.
- Describe the instruction, not its effect. You do not know what the effect was.
- No quotes, no trailing punctuation.

Return ONLY JSON: {"a": "...", "b": "..."}

FIRST:
%s

SECOND:
%s"""


def _clean(value, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip().strip('"').strip(".")
    # Long enough to be a sentence is long enough to break the layout it sits in.
    return text[:40] if text else fallback


async def name_contexts(llm, a: str, b: str) -> dict:
    """Two short, distinguishing names — or the neutral fallback, said plainly."""
    a, b = (a or "").strip(), (b or "").strip()
    if not a or not b:
        return {"a": FALLBACK[0], "b": FALLBACK[1], "source": "fallback",
                "reason": "both contexts are needed before they can be told apart"}
    try:
        resp = await llm.chat_completion(
            messages=[{"role": "user", "content": _PROMPT % (a[:1500], b[:1500])}],
            # Pinned like the probes this names the arms of. No model name is sent, so
            # this never produced the 404 the reasoning check did — but the route that
            # reaches it admits callers on an OpenAI key, and `own_key_only` refuses
            # any backend but `openai` to a caller who supplied only that one. The
            # refusal is then swallowed by the fallback below, so somebody paying with
            # their own OpenAI key silently got "Context A" / "Context B" and a reason
            # saying the call did not come back. It came back; it was never allowed to
            # leave.
            backend="openai",
            temperature=0.2,
            max_tokens=120,
        )
        raw = (resp["choices"][0]["message"]["content"] or "").strip()
        match = re.search(r"\{.*\}", raw, re.S)
        parsed = json.loads(match.group(0)) if match else {}
        name_a = _clean(parsed.get("a"), FALLBACK[0])
        name_b = _clean(parsed.get("b"), FALLBACK[1])
        if name_a.lower() == name_b.lower():
            # Two identical labels are worse than A and B: they look informative and
            # are not, and the reader has no way to tell which bar is which.
            return {"a": FALLBACK[0], "b": FALLBACK[1], "source": "fallback",
                    "reason": "the suggested names did not distinguish the two"}
        return {"a": name_a, "b": name_b, "source": "model"}
    except Exception as exc:
        logger.warning("context naming failed: %s", exc)
        return {"a": FALLBACK[0], "b": FALLBACK[1], "source": "fallback",
                "reason": "the naming call did not come back"}
