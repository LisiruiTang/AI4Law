"use client";

import { Footnote, FnHeading, FnList, Mono } from "./Footnote";

/**
 * The method notes, kept in one file so the tabs cannot drift apart on what they claim
 * about how the numbers are produced.
 */


export function TokenProbsFootnote() {
  return (
    <Footnote title="How these numbers are produced, and which models can produce them">
      <FnHeading>One call, not repeated sampling</FnHeading>
      <p>
        A measurement is a single request; a comparison is two, one per condition. The
        percentages are not frequencies counted over runs — they are read from the
        model&apos;s distribution at one position. Obtaining the same figures by
        generating repeatedly would take hundreds of runs and still yield only an
        estimate.
      </p>
      <p>
        The prompt forces the answer into one word and <Mono>max_tokens=1</Mono> stops it
        there, the first position being the only readable one.{" "}
        <Mono>logprobs</Mono> returns the twenty likeliest tokens with their
        log-probabilities. Each is exponentiated, matched to a label by prefix in either
        direction — <Mono>&quot;Yes&quot;</Mono>, <Mono>&quot; yes&quot;</Mono> and{" "}
        <Mono>&quot; ye&quot;</Mono> all count for <Mono>yes</Mono> — summed per label,
        then divided by their total.
      </p>
      <p>
        <span className="text-zinc-300">Temperature does not affect these numbers.</span>{" "}
        The log-probabilities a provider reports are the pre-temperature distribution —
        measured identical from 0 to 2 — so the figures here would be the same at any
        setting. It is held at 1.0 only so that <Mono>sampled</Mono>, shown beside the
        distribution, is an honest draw from it. Nothing in the percentages is sampled.
      </p>

      <FnHeading>What the denominator conceals</FnHeading>
      <p>
        Dividing by the labels&apos; own total makes the bars sum to 100% however little
        of the real distribution they captured.{" "}
        <span className="text-zinc-300">Captured mass</span> is that share, and the figure
        by which to judge the rest: at 30%, the model largely wanted to say something else
        and the percentages are computed over the remainder. A warning appears below 50%.
      </p>
      <p>Two further limits follow from using an API rather than reading logits directly:</p>
      <FnList>
        <li>
          Only the top twenty tokens return, so a label outside that window reads as
          zero rather than as unseen.
        </li>
        <li>
          Only the first token is constrained, so labels sharing a leading token are
          indistinguishable.
        </li>
      </FnList>

      <FnHeading>Models</FnHeading>
      <p>
        Any chat model returning log-probabilities. The 4o and 4.1 families are in the
        dropdown, all four verified. Reasoning models (o1, o3) return none. Anthropic
        exposes none on any model, which is why this requires an OpenAI key whatever
        backend is configured elsewhere.
      </p>
      <p>
        Switching models is instructive. On one LegalBench item the four disagree sharply
        — 86% on &ldquo;certainly hearsay&rdquo; from one, 82% on the answer below it from
        another — and all four are confidently wrong against the benchmark.
      </p>

      <FnHeading>Use graded labels</FnHeading>
      <p>
        Instruction-tuned models saturate on categorical choices. Asked{" "}
        <Mono>yes / no</Mono> on the hearsay items they answer 100%, and any change to the
        prompt registers as no change; asked for a 1–5 score the mass spreads and the same
        change moves 99% of it.
      </p>

    </Footnote>
  );
}

