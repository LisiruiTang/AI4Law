"use client";

import { useEffect, useState } from "react";
import { SetupBar, type BuiltIn } from "./SetupBar";
import { BeamTree } from "./BeamTree";
import { fetchProbeAvailability, probeBeam, type BeamResult, type ProbeAvailability } from "@/lib/api";
import { ProbeUnavailable } from "./ProbeUnavailable";
import { DecodingFootnote } from "./footnotes";

/**
 * Top-K branching walk: at every step keep the K likeliest continuations of every
 * surviving chain, score chains by cumulative probability, keep the best few.
 *
 * The thing worth seeing is that greedy decoding — always take the likeliest next
 * token — does not produce the likeliest sequence. A token at 10% can open onto
 * continuations so probable that the chain overtakes one that started at 18%. The
 * panel always draws both paths and states the ratio between them.
 */

// THE RULE HERE CHANGED on 2026-10-02, and the old one is worth quoting: "every preset has
// been checked to actually split — one that ends 'greedy won' makes the whole idea look
// like a technicality." That was written against `gpt-3.5-turbo-instruct`, a base model
// whose distributions are flat enough that a mid-ranked opener often wins the sequence.
//
// Re-measured on gpt-4o-mini, all four old presets ended "greedy won" — instruction tuning
// collapses entropy, so the locally likeliest token is usually also the start of the
// likeliest sequence. Three of the four notes quoted multipliers ("over 10× likelier", "a
// 6× gap") that no longer happen at all.
//
// So the set is now a measured mix, and whether it splits is part of what each one teaches.
// A preset that ends "greedy won" is not a technicality on a modern model; it is the reason
// production systems get away with greedy decoding, and hiding it would make the panel
// argue for beam search on evidence its own default model does not supply. The notes say
// what to watch rather than quoting a ratio — the panel displays the real one, and a number
// in prose is a number that goes stale, which is exactly how this comment came to exist.
//
// Each preset carries the search width its lesson needs: the objection fork only appears
// with a wider, deeper search, and claiming it at k=3 would be promising something the
// default settings cannot show.
//
// The fact pattern marked LegalBench is taken from that benchmark's hearsay task, cut at
// the point where the analysis forks.
/** What a saved branching-walk setup carries. Inputs only. */
export interface BeamConfig extends Record<string, unknown> {
  prompt: string;
  k: number;
  depth: number;
  beamWidth: number;
  /** Optional so a setup saved before this control existed still loads. */
  minLength?: number;
}

/** Shortest chain allowed to win. Matches the backend's default; see `beam_search` for the
 *  trade-off it sets and why 2 rather than half the walk. */
const DEFAULT_MIN_LENGTH = 2;

const EMPTY: BeamConfig = {
  prompt: "",
  k: 3,
  depth: 6,
  beamWidth: 10,
  minLength: DEFAULT_MIN_LENGTH,
};

/**
 * Worked examples, chosen so the mechanism is visible rather than the subject matter.
 *
 * The set used to be mostly one benchmark's hearsay items, which made the panel read
 * as a law demo when what it shows — that the greedy token and the likeliest sequence
 * are different things — has nothing to do with law.
 */
/** The two requested Branching Tree prompts; Blank is provided by SetupBar. */
const PRESETS: {
  name: string;
  prompt: string;
  note: string;
  k: number;
  depth: number;
  beamWidth: number;
}[] = [
  {
    name: "Immediately After",
    prompt: 'The maximum number of minutes that can pass and still count as "immediately after" is',
    note: "Explore how the same legal question branches under different variation settings.",
    k: 3,
    depth: 6,
    beamWidth: 10,
  },
  {
    name: "Manifested",
    prompt: 'A person has "manifested" adoption or belief when they',
    note: "Explore how the same legal question branches under different variation settings.",
    k: 3,
    depth: 6,
    beamWidth: 10,
  },
];
const PRESET_DEFAULTS = { prompt: "", k: 3, depth: 6, beamWidth: 10 };

export function BeamPanel() {
  const [status, setStatus] = useState<ProbeAvailability | null>(null);

  const [prompt, setPrompt] = useState(PRESET_DEFAULTS.prompt);
  const [temperature, setTemperature] = useState(1.0);
  const [depth, setDepth] = useState(6);
  const [beamWidth, setBeamWidth] = useState(10);
  const [minLength, setMinLength] = useState(DEFAULT_MIN_LENGTH);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BeamResult | null>(null);
  const [maxStep, setMaxStep] = useState(0);
  const [showPruned, setShowPruned] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetchProbeAvailability().then(setStatus);
  }, []);

  // Growing the tree a step at a time is the point — it is a branching *process*,
  // and revealing it all at once loses the moment where the paths split.
  useEffect(() => {
    if (!playing || !result) return;
    if (maxStep >= result.depth) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setMaxStep((s) => s + 1), 850);
    return () => clearTimeout(t);
  }, [playing, maxStep, result]);

  async function run(nextTemperature = temperature) {
    if (!prompt.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setMaxStep(0);
    try {
      const r = await probeBeam({
        prompt,
        k: 3,
        temperature: nextTemperature,
        top_p: 0.9,
        depth,
        beam_width: beamWidth,
        min_length: minLength,
      });
      setResult(r);
      setMaxStep(0);
      setPlaying(true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  }

  if (status && !status.available) {
    return <ProbeUnavailable status={status} />;
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="space-y-3">
        <SetupBar<BeamConfig>
          kind="beam"
          builtIns={PRESETS.map((p): BuiltIn<BeamConfig> => ({
            name: p.name,
            note: p.note,
            // Each preset's own search width, not one hardcoded triple. The objection
            // fork only appears with a wider, deeper search, so loading it at k=3 would
            // show the opposite of what its note promises.
            config: {
              prompt: p.prompt,
              k: p.k,
              depth: p.depth,
              beamWidth: p.beamWidth,
              minLength: DEFAULT_MIN_LENGTH,
            },
          }))}
          blank={EMPTY}
          current={{ prompt, k: 3, depth, beamWidth, minLength }}
          onLoad={(c) => {
            setPrompt(c.prompt ?? "");
            if (typeof c.depth === "number") setDepth(c.depth);
            if (typeof c.beamWidth === "number") setBeamWidth(c.beamWidth);
            // A setup saved before this control existed carries no floor; derive the
            // default from its depth rather than leaving whatever the last run used.
            setMinLength(
              typeof c.minLength === "number" ? c.minLength : DEFAULT_MIN_LENGTH
            );
            setResult(null);
            setError(null);
          }}
        />

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Text for the model to continue…"
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Variation">
          <span className="mr-1 text-xs text-[var(--text-muted)]">Variation</span>
          {([
            [0.2, "Low"],
            [1.0, "Medium"],
            [1.8, "High"],
          ] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={temperature === value}
              onClick={() => {
                setTemperature(value);
                if (prompt.trim()) void run(value);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                temperature === value
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-1 text-[10px] text-[var(--text-muted)]">
            temperature {temperature.toFixed(1)} · k = 3 · p = 0.9
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <Slider
            label="Steps"
            value={depth}
            min={2}
            max={8}
            onChange={(d) => {
              setDepth(d);
              // A floor longer than the walk would exclude every chain, so the backend
              // clamps it; clamping here too keeps the slider from showing a value that
              // is not the one being used.
              if (minLength > d) setMinLength(d);
            }}
          />
          <Slider label="Chains kept" value={beamWidth} min={2} max={16} onChange={setBeamWidth} />
          <Slider
            label="Shortest chain"
            value={minLength}
            min={1}
            max={depth}
            onChange={setMinLength}
          />
          <button
            onClick={() => void run()}
            disabled={running || !prompt.trim()}
            className="px-4 py-2 text-xs rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-200 hover:bg-violet-500/30 disabled:opacity-40 transition-colors"
          >
            {running ? "Branching…" : "Grow the tree"}
          </button>
          {/* MEASURED once there is a result, and an upper bound before.
              This used to read `≈{1 + k + beamWidth * (depth - 2)} calls, 1 token each`,
              which was exact while every node cost its own one-token call — 44 at the
              defaults. Neither half survives: a single response now carries a whole argmax
              path, so a branch that follows the model's own continuation is free, and the
              saving depends on the prompt rather than on k and depth. Measured, the
              defaults cost about 17. Showing the formula as if it were the cost would be a
              number in the interface that nothing checks. */}
          <span className="text-[10px] text-[var(--text-muted)]">
            {result
              ? `${result.calls} call${result.calls === 1 ? "" : "s"}`
              : `at most ${1 + 3 + beamWidth * Math.max(depth - 2, 0)} calls`}
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {!result && !running && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-xs text-[var(--text-muted)] leading-relaxed max-w-3xl">
          <p className="text-zinc-300 mb-2">What this shows</p>
          <p className="mb-2">
            A model writes one token at a time, with a probability for every word that
            could come next. <span className="text-zinc-300">Greedy</span> decoding takes
            the highest and never looks back. But a sentence&apos;s probability is all its
            tokens multiplied together, so one starting on a less likely word can end up
            more probable overall.
          </p>
          <p className="mb-2">
            So this searches instead. It keeps up to three continuations of every live
            chain and discards all but the {beamWidth} best-scoring chains each round —{" "}
            <span className="text-zinc-300">beam search</span>, drawn as a tree.
          </p>
          <p className="mb-2">
            The <span className="text-amber-300">amber</span> path is greedy. The{" "}
            <span className="text-teal-300">teal</span> path is the best-scoring chain.
            Where they agree they run <span className="text-violet-300">violet</span>.
          </p>
          <p className="mb-2">
            Chains are scored <span className="text-zinc-300">per token</span> — the
            geometric mean of their probabilities — so chains of any length compete. Without
            that, the raw product falls with every step and a one-word chain wins almost by
            arithmetic. With it, a short chain wins only when it is near-certain: “Two plus
            two equals” gives “ four” at 99.9%, and nothing longer beats it.
          </p>
          <p className="mb-2">
            Scoring per token has its own bias: every extra token multiplies in a
            probability below 1, so the measure would rather stop than commit, and the
            winner tends to be the greedy chain truncated.{" "}
            <span className="text-zinc-300">Shortest chain</span> is the floor on that —
            raise it to force the search to commit, drop it to 1 and a confident one-word
            answer can win.
          </p>
          <p className="mb-2 text-zinc-400">
            “Best-scoring” is not “best”. It is the highest probability under the selected
            temperature and cutoffs — a likelier chain can still be dull, wrong or repetitive.
          </p>
          <p>
            The variation setting reshapes the probabilities before the tree is built. Low
            concentrates probability on the strongest next tokens; High spreads it more
            evenly. The prompt, k = 3, and p = 0.9 stay fixed for each comparison.
          </p>
        </div>
      )}

      {result && (
        <>
          {/* Verdict — three shapes, not two. Chains of any length compete on their
              per-token score, so the winner can be a shorter PREFIX of the greedy chain
              rather than a fork away from it. Those are different findings and a single
              "they parted company at step N" cannot say both. */}
          <div
            className={`rounded-xl border px-4 py-3 max-w-4xl ${
              result.relation === "diverged"
                ? "border-teal-500/40 bg-teal-500/5"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            {result.relation === "diverged" ? (
              <>
                <div className="text-sm text-white mb-1.5">
                  Taking the top word every time did not produce the likeliest sentence —
                  the two parted company at step {result.divergence_step}.
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                  The sentence the search found is{" "}
                  <span className="text-teal-300 font-semibold">
                    {result.advantage.toFixed(2)}×
                  </span>{" "}
                  likelier per token. It took a lower-probability word at step{" "}
                  {result.divergence_step} and was repaid by what that opened up.
                </p>
              </>
            ) : result.relation === "prefix" ? (
              <>
                <div className="text-sm text-white mb-1.5">
                  The likeliest chain is the greedy one, stopped early — after{" "}
                  {result.best.ids.length} token
                  {result.best.ids.length === 1 ? "" : "s"} rather than{" "}
                  {result.greedy.ids.length}.
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                  The two never fork; the shorter one simply scores{" "}
                  <span className="text-teal-300 font-semibold">
                    {result.advantage.toFixed(2)}×
                  </span>{" "}
                  better per token by stopping while the going is good. Every further token
                  can only multiply in a probability below 1, so continuing costs something
                  unless what follows is near-certain. Where the text has one obvious
                  completion this is the honest answer — and it is also the weakness of a
                  per-token score, which would rather stop than commit.
                </p>
              </>
            ) : (
              <>
                <div className="text-sm text-white mb-1.5">
                  Taking the top word every time happened to be right here.
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                  No chain scored better, at any length. That is the common case on an
                  instruction-tuned model, and why most systems decode greedily.
                  <br />
                  The paths only separate where the model is genuinely undecided. Hover a
                  node for its <span className="text-zinc-300">entropy</span> — below about
                  one bit the top token is nearly always the start of the best sequence. The{" "}
                  <span className="text-zinc-300">Essay feedback</span> preset runs near 2.9
                  bits and forks every run.
                </p>
              </>
            )}
            {result.min_length_binding && (
              <p className="text-xs text-amber-300/90 leading-relaxed mb-3">
                A shorter chain scored better and was not eligible —{" "}
                <span className="text-zinc-300">Shortest chain</span> is set to{" "}
                {result.min_length}. Drop it to see what it excluded.
              </p>
            )}
            <div className="space-y-1.5 font-mono text-xs">
              <ChainRow
                label="greedy"
                color="text-amber-300"
                text={result.greedy.text}
                cum={result.greedy.cum_prob}
                avg={result.greedy.avg_prob}
              />
              <ChainRow
                label="likeliest"
                color="text-teal-300"
                text={result.best.text}
                cum={result.best.cum_prob}
                avg={result.best.avg_prob}
              />
            </div>
          </div>

          {/* Playback */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                if (maxStep >= result.depth) setMaxStep(0);
                setPlaying((p) => !p);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
            >
              {playing ? "Pause" : maxStep >= result.depth ? "Replay" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={result.depth}
              value={maxStep}
              onChange={(e) => {
                setPlaying(false);
                setMaxStep(Number(e.target.value));
              }}
              className="flex-1 min-w-40 max-w-md accent-violet-500"
            />
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
              step {maxStep} / {result.depth}
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showPruned}
                onChange={(e) => setShowPruned(e.target.checked)}
                className="accent-zinc-500"
              />
              Show discarded branches
            </label>
            <span className="text-[10px] text-zinc-600">{result.model}</span>
          </div>

          <BeamTree result={result} showPruned={showPruned} maxStep={maxStep} />

          {/* Directly under the diagram, which is the only place a legend means anything.
              It used to sit below ProvenanceNote, a whole collapsible section further down,
              so a reader met "␣ marks a leading space" having scrolled past the chart it
              labels and read as a stray paragraph with no referent. */}
          <p className="text-[11px] text-[var(--text-muted)] max-w-3xl leading-relaxed">
            ␣ marks a leading space, ⏎ a line break. The percentage under each token is its
            probability after temperature, top-p, and top-k; multiplying along a path gives
            the chain score.
            Hover a token for its entropy and the chain score so far.
          </p>

          <ProvenanceNote />
        </>
      )}

      <DecodingFootnote />
    </div>
  );
}

/**
 * The honest caveat. Beam search is genuinely how this tree works, but it is NOT how
 * a chat model generates prose today, and letting a faculty member walk away thinking
 * otherwise would be worse than not showing them anything.
 */
function ProvenanceNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 max-w-3xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2.5 text-xs text-zinc-300 hover:text-white transition-colors"
      >
        {open ? "▾" : "▸"} Do real systems work this way? And what is this leaving out?
      </button>
      {open && (
        <div className="px-4 pb-4 text-[11px] text-[var(--text-muted)] leading-relaxed space-y-2">
          <p className="text-zinc-300">Does ChatGPT do this?</p>
          <p>
            No. Chat models do not search for the likeliest sentence — they{" "}
            <span className="text-zinc-300">sample</span>, rolling a weighted die over the
            plausible next words, which is why the same prompt gives a different answer
            twice. <span className="text-zinc-300">Temperature</span>,{" "}
            <span className="text-zinc-300">top-p</span> and{" "}
            <span className="text-zinc-300">top-k</span> all shape that die. The three
            settings above compare temperature while keeping the prompt, k, and p fixed.
          </p>
          <p>
            Beam search is used where there is one right answer: translation,
            speech-to-text, summarising. It is almost never used for open conversation.
            Holtzman et al. (2020) showed that chasing the most probable sentence produces
            bland, repetitive writing — highest probability means{" "}
            <em>most predictable</em>. That finding is where top-p sampling came from.
          </p>
          <p>
            So the point of the tree is not the algorithm but the fact it exploits:{" "}
            <span className="text-zinc-300">the best next step is not always the best
            move</span>. The same idea returns at larger scale, where systems explore whole
            reasoning steps or whole answers rather than single words — sampling an answer
            several times and taking the majority, or sketching several approaches and
            scoring them before committing.
          </p>

          <p className="text-zinc-300 pt-1">What this leaves out</p>
          <p>
            A real system does more than choose which words to consider. It usually pushes
            down words already used, so the model stops repeating itself. Where output must
            be valid JSON or follow a fixed form, it can block any word that would break the
            format. And some systems use a small fast model to guess ahead and a large one to
            check the guess, which speeds generation without changing it.
          </p>
          <p>
            Every branch here was chosen on this server. The model is asked only what could
            come next and how likely each is; it returns its twenty likeliest words with
            their probabilities, and the selecting and pruning happen locally. Those twenty
            are the top of a list running to tens of thousands — across a long walk they
            carry 96–100% of the probability, and each step reports its own figure.
          </p>
          <ul className="space-y-1 pt-1">
            <li>
              Holtzman et al., “The Curious Case of Neural Text Degeneration”, ICLR 2020 —{" "}
              <a
                href="https://arxiv.org/abs/1904.09751"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                arXiv:1904.09751
              </a>
            </li>
            <li>
              Wang et al., “Self-Consistency Improves Chain of Thought Reasoning”, ICLR
              2023 —{" "}
              <a
                href="https://arxiv.org/abs/2203.11171"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                arXiv:2203.11171
              </a>
            </li>
            <li>
              Yao et al., “Tree of Thoughts”, NeurIPS 2023 —{" "}
              <a
                href="https://arxiv.org/abs/2305.10601"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                arXiv:2305.10601
              </a>
            </li>
            <li>
              Guha et al., “LegalBench”, NeurIPS 2023 —{" "}
              <a
                href="https://arxiv.org/abs/2308.11462"
                target="_blank"
                rel="noreferrer"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
              >
                arXiv:2308.11462
              </a>{" "}
              — source of the hearsay fact patterns used in the presets
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function ChainRow({
  label,
  color,
  text,
  cum,
  avg,
}: {
  label: string;
  color: string;
  text: string;
  cum: number;
  avg: number;
}) {
  return (
    <div className="flex items-baseline gap-2">
      {/* w-20, not w-12. The rows are font-mono text-xs, so a character is about 7.2px and
          "likeliest" needs ~65px — it overflowed a 48px box and ran into the sentence
          beside it. `shrink-0` kept the box from shrinking but nothing kept the text
          inside it. Wide enough for the longer of the two labels, and both rows share the
          width so the sentences stay aligned. */}
      <span className={`${color} w-20 shrink-0 whitespace-nowrap`}>{label}</span>
      <span className="flex-1 text-zinc-200 break-words">{text.replace(/^ /, "")}</span>
      <span className="text-zinc-500 shrink-0 tabular-nums" title="probability of the whole chain">
        {cum < 0.001 ? cum.toExponential(1) : (cum * 100).toFixed(3) + "%"}
      </span>
      <span
        className="text-zinc-600 shrink-0 tabular-nums"
        title="per-token geometric mean, comparable across lengths"
      >
        avg {(avg * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
        {label} <span className="text-zinc-400">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-violet-500"
      />
    </label>
  );
}
