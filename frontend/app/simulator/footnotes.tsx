"use client";

import { Footnote, FnHeading, FnList, Mono } from "./Footnote";

/**
 * The method notes, kept in one file so the tabs cannot drift apart on what they claim
 * about how the numbers are produced.
 */

/**
 * The framing every tab shares: these are small experiments on a stochastic system,
 * not demonstrations of a tool.
 *
 * MOVED TO THE PAGE, 2026-10-02. It used to be rendered inside each of the four method
 * notes, which put page-level framing in four tab-level places — and its own text
 * cross-references every tab ("prompt sensitivity is what the on/off comparisons measure",
 * "variability is what the sampled decoding strategies expose"), so arriving at it under
 * the heading "How the five strategies are run" read as a claim about decoding.
 *
 * Exported bare as well as wrapped, so a future tab that genuinely needs it inline can
 * have it without duplicating the text.
 */
export function SimulatorPremise() {
  return (
    <>
      <FnHeading>Premise</FnHeading>
      <p>
        Each tab treats the model as{" "}
        <span className="text-zinc-300">an object of study rather than an assistant</span>
        : a system whose variability, bias and prompt sensitivity are established by
        designing a small experiment and running it. That framing — and the case for
        teaching it at every level, from &ldquo;ask it twice&rdquo; in an introductory
        course to a stability audit of a full workflow — is set out in{" "}
        <a
          href="https://arxiv.org/abs/2606.29754"
          target="_blank"
          rel="noreferrer"
          className="text-law-light hover:text-law-light underline underline-offset-2"
        >
          Probing the Stochastic Machine
        </a>{" "}
        (Tian Zheng), which reads these systems through Veridical Data Science and its
        predictability, computability and stability principles.
      </p>
      <p>
        <span className="text-zinc-300">Prompt sensitivity</span> is what the on/off and
        rule-A/rule-B comparisons measure.{" "}
        <span className="text-zinc-300">Variability</span> is what the sampled decoding
        strategies expose, and what reading a distribution rather than a sample avoids.{" "}
        <span className="text-zinc-300">Stability</span> is the question behind the
        calibration gap and behind running one item across several models.
      </p>
    </>
  );
}

/** The premise as its own note, for the page rather than a tab. Collapsed like the rest. */
export function SimulatorPremiseFootnote() {
  return (
    <Footnote title="What these tabs are for">
      <SimulatorPremise />
    </Footnote>
  );
}

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

function OracleNote() {
  return (
    <>
      <FnHeading>The model is only asked what comes next</FnHeading>
      <p>
        At each step the model is asked one question — given this text, what could come
        next, and how likely is each — and answers with its twenty likeliest tokens and
        their probabilities. Choosing among them happens here, in{" "}
        <Mono>backend/probes/strategies.py</Mono>, about four lines per strategy.
      </p>

      <FnHeading>Three limits worth knowing</FnHeading>
      <FnList>
        <li>
          <span className="text-zinc-300">Twenty candidates, not the whole vocabulary.</span>{" "}
          Measured across a long walk they carry 96–100% of the probability, and each step
          reports its own figure.
        </li>
        <li>
          <span className="text-zinc-300">The model is told to continue the passage.</span>{" "}
          So these are the probabilities of what comes next given the text{" "}
          <em>and that instruction</em>, not of the text alone.
        </li>
        <li>
          <span className="text-zinc-300">Spacing comes from the model.</span> A chat reply
          begins at a message boundary, where the first token loses its leading space. To
          avoid guessing it, the model is asked to resume from the passage&apos;s final
          fragment, so the join sits inside its reply where the space is real. Tokens are
          then appended exactly as returned. This needs the model to follow one instruction
          precisely: <Mono>gpt-4o-mini</Mono> does on both providers, smaller open models do
          not, and the page says so rather than showing text with the spaces misplaced.
        </li>
      </FnList>
      <p>
        Temperature is applied here too, to the numbers the model reported. The
        probabilities a provider hands back are the{" "}
        <span className="text-zinc-300">pre-temperature</span> ones, so a temperature sent to
        the API changes the text it writes without changing any figure shown here.
      </p>
    </>
  );
}


/** The branching tree. One strategy, so it does not carry the list of five.
 *
 * Titled away from "How these numbers are produced", which is the Token probabilities note
 * on the neighbouring tab. Two notes with near-identical titles on adjacent tabs is how a
 * reader comes to think they have already read one of them.
 */
export function DecodingFootnote() {
  return (
    <Footnote title="How the tree is built">
      <OracleNote />
      <FnHeading>This view runs one strategy</FnHeading>
      <p>
        Beam search, which is not a per-step rule: it keeps several chains alive and scores
        whole sequences, which is what the tree draws. Chains are ranked by their per-token
        geometric mean so that chains of different lengths can be compared, with{" "}
        <span className="text-zinc-300">Shortest chain</span> as the floor on how early a
        winner may stop.
      </p>
    </Footnote>
  );
}

