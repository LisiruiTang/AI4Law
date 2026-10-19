"use client";

import { useEffect, useRef, useState } from "react";
import { SetupBar, type BuiltIn } from "./SetupBar";
import { BeamTree } from "./BeamTree";
import { fetchProbeAvailability, probeBeamVariations, type BeamResult, type BeamVariations, type Variation, type ProbeAvailability } from "@/lib/api";
import { ProbeUnavailable } from "./ProbeUnavailable";
import { AdminExampleEditor } from "./AdminExampleEditor";
import { fetchExamples, type PortalExample } from "@/lib/portal";

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
// The fact pattern marked LegalBench is taken from that benchmark's hearsay task, cut at
// the point where the analysis forks.
/** What a saved branching-walk setup carries. Inputs only. */
export interface BeamConfig extends Record<string, unknown> {
  prompt: string;
  k: number;
  temperature?: number;
  depth: number;
  beamWidth: number;
  /** Optional so a setup saved before this control existed still loads. */
  minLength?: number;
}

/** Shortest chain allowed to win. Matches the backend's default; see `beam_search` for the
 *  trade-off it sets and why 2 rather than half the walk. */
const DEFAULT_MIN_LENGTH = 2;
const VARIATIONS = [
  { key: "low", label: "Low", temperature: 0.2 },
  { key: "medium", label: "Medium", temperature: 1.0 },
  { key: "high", label: "High", temperature: 1.8 },
] as const;

function variationFor(temperature: number): Variation {
  return VARIATIONS.find((item) => item.temperature === temperature)?.key ?? "medium";
}

const EMPTY: BeamConfig = {
  prompt: "",
  k: 3,
  temperature: 1.0,
  depth: 6,
  beamWidth: 10,
  minLength: DEFAULT_MIN_LENGTH,
};

const PRESET_DEFAULTS = { prompt: "", k: 3, depth: 6, beamWidth: 10 };

type BeamPreset = BeamConfig & { name: string; note: string };

export function BeamPanel({ adminMode = false }: { adminMode?: boolean }) {
  const [status, setStatus] = useState<ProbeAvailability | null>(null);
  const [presets, setPresets] = useState<BeamPreset[]>([]);
  const [examples, setExamples] = useState<PortalExample<BeamConfig>[]>([]);
  const [selectedExample, setSelectedExample] = useState<PortalExample<BeamConfig> | null>(null);
  const [presetError, setPresetError] = useState("");

  const [prompt, setPrompt] = useState(PRESET_DEFAULTS.prompt);
  const [k, setK] = useState(3);
  const [temperature, setTemperature] = useState(1.0);
  const [depth, setDepth] = useState(6);
  const [beamWidth, setBeamWidth] = useState(10);
  const [minLength, setMinLength] = useState(DEFAULT_MIN_LENGTH);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BeamResult | null>(null);
  const [variationResults, setVariationResults] = useState<BeamVariations | null>(null);
  const [maxStep, setMaxStep] = useState(0);
  const [showPruned, setShowPruned] = useState(false);
  const [playing, setPlaying] = useState(false);
  const latestRun = useRef(0);

  useEffect(() => {
    fetchProbeAvailability().then(setStatus);
  }, []);

  useEffect(() => {
    void reloadExamples().catch((e) => setPresetError(e instanceof Error ? e.message : String(e)));
  }, []);

  function load(config: BeamConfig) {
    clearResult();
    setPrompt(config.prompt ?? "");
    setK(typeof config.k === "number" ? Math.max(2, Math.min(10, Math.round(config.k))) : 3);
    setTemperature(config.temperature === 0.2 || config.temperature === 1.8 ? config.temperature : 1.0);
    if (typeof config.depth === "number") setDepth(config.depth);
    if (typeof config.beamWidth === "number") setBeamWidth(config.beamWidth);
    setMinLength(typeof config.minLength === "number" ? config.minLength : DEFAULT_MIN_LENGTH);
  }

  function clearResult() {
    latestRun.current += 1;
    setResult(null);
    setVariationResults(null);
    setPlaying(false);
    setRunning(false);
    setError(null);
    setMaxStep(0);
  }

  async function reloadExamples(selectId?: number) {
    const rows = await fetchExamples<BeamConfig>("beam");
    setExamples(rows);
    setPresets(rows.map((row) => ({ ...row.config, name: row.name, note: row.note })));
    const selected = rows.find((row) => row.id === selectId) ?? rows[0] ?? null;
    setSelectedExample(selected);
    load(selected?.config ?? EMPTY);
    setPresetError("");
  }

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

  async function run() {
    if (!prompt.trim()) return;
    const runId = ++latestRun.current;
    setRunning(true);
    setError(null);
    setResult(null);
    setVariationResults(null);
    setMaxStep(0);
    try {
      const all = await probeBeamVariations({
        prompt,
        k,
        depth,
        beam_width: beamWidth,
        min_length: minLength,
      });
      if (runId === latestRun.current) {
        setVariationResults(all);
        setResult(all.variations[variationFor(temperature)]);
        setMaxStep(0);
        setPlaying(true);
      }
    } catch (e) {
      if (runId === latestRun.current) setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (runId === latestRun.current) setRunning(false);
    }
  }

  function selectTemperature(value: number) {
    setTemperature(value);
    if (variationResults) {
      const next = variationResults.variations[variationFor(value)];
      setResult(next);
      setPlaying(false);
      setMaxStep(next.depth);
    }
  }

  if (status && !status.available && !adminMode) {
    return <ProbeUnavailable status={status} />;
  }

  return (
    <div className="space-y-5">
      {presetError && <p role="alert" className="text-sm text-rose-300">Could not load examples: {presetError}</p>}
      {adminMode && status && !status.available && <ProbeUnavailable status={status} />}
      {/* Controls */}
      <div className="space-y-3">
        <SetupBar<BeamConfig>
          kind="beam"
          selectedName={adminMode ? selectedExample?.name ?? "Blank" : undefined}
          builtIns={presets.map((p): BuiltIn<BeamConfig> => ({
            name: p.name,
            note: p.note,
            config: {
              prompt: p.prompt,
              k: p.k ?? 3,
              temperature: p.temperature ?? 1.0,
              depth: p.depth,
              beamWidth: p.beamWidth,
              minLength: p.minLength ?? DEFAULT_MIN_LENGTH,
            },
          }))}
          blank={EMPTY}
          current={{ prompt, k, temperature, depth, beamWidth, minLength }}
          onLoad={(config, name) => {
            setSelectedExample(examples.find((row) => row.name === name) ?? null);
            load(config);
          }}
        />

        {adminMode && <AdminExampleEditor<BeamConfig>
          key={selectedExample?.id ?? "blank"}
          kind="beam" selected={selectedExample}
          current={{ prompt, k, temperature, depth, beamWidth, minLength }}
          reload={reloadExamples}
        />}

        <textarea
          value={prompt}
          onChange={(e) => { clearResult(); setPrompt(e.target.value); }}
          rows={2}
          placeholder="Text for the model to continue…"
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-law-light"
        />

        <fieldset className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <legend className="px-1 text-xs font-semibold text-law-light">Variation</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {VARIATIONS.map((item) => (
              <div key={item.key} className="space-y-2">
                <button
                  type="button"
                  aria-pressed={temperature === item.temperature}
                  disabled={running}
                  onClick={() => selectTemperature(item.temperature)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${temperature === item.temperature ? "border-law-light bg-law-light/15 text-law-light" : "border-zinc-700 text-zinc-300 hover:border-law-light/60"}`}
                >
                  <span className="block font-semibold">{item.label}</span>
                  <span className="mt-1 block text-[11px]">Temperature {item.temperature.toFixed(1)} · P = 0.9</span>
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-3 text-xs leading-relaxed text-[var(--text-muted)] sm:grid-cols-3">
            <p><strong className="text-zinc-200">Temperature</strong> changes how concentrated or spread out the next-word probabilities are.</p>
            <p><strong className="text-zinc-200">P = 0.9</strong> first keeps the most likely candidates until their combined probability reaches at least 90%. K then limits how many remain.</p>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-4">
          <Slider label="Branches per step (K)" value={k} min={2} max={10} onChange={(value) => { clearResult(); setK(value); }} />
          <Slider
            label="Steps"
            value={depth}
            min={2}
            max={8}
            onChange={(d) => {
              clearResult();
              setDepth(d);
              // A floor longer than the walk would exclude every chain, so the backend
              // clamps it; clamping here too keeps the slider from showing a value that
              // is not the one being used.
              if (minLength > d) setMinLength(d);
            }}
          />
          <Slider label="Chains kept" value={beamWidth} min={2} max={16} onChange={(n) => { clearResult(); setBeamWidth(n); }} />
          <Slider
            label="Shortest chain"
            value={minLength}
            min={1}
            max={depth}
            onChange={(n) => { clearResult(); setMinLength(n); }}
          />
          <button
            onClick={() => void run()}
            disabled={running || !prompt.trim()}
            className="px-4 py-2 text-xs rounded-lg bg-law-light/20 border border-law-light/40 text-law-light hover:bg-law-light/30 disabled:opacity-40 transition-colors"
          >
            {running ? "Calculating all three settings…" : "Grow the tree"}
          </button>
          {/* Count the calls used to calculate the complete three-setting comparison. */}
          <span className="text-[10px] text-[var(--text-muted)]">
            {variationResults ? `${variationResults.calls} calls for all three settings` : ""}
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 text-xs text-[var(--text-muted)] leading-relaxed max-w-4xl" aria-label="How to use Branching Walk">
        <h2 className="text-sm font-semibold text-zinc-100 mb-2">How to read the branching walk</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <p><strong className="text-law-gold">Greedy</strong> builds the text one step at a time, always choosing the next word or word fragment with the highest probability.</p>
            <p><strong className="text-law-bright">Likeliest</strong> compares several possible continuations explored by the simulator. It chooses the continuation with the highest average probability score across its steps. This may involve choosing a less likely word at one step because the words that follow it are more likely.</p>
          </div>
          <div className="space-y-3">
            <p><strong className="text-zinc-200">Branches per step (K)</strong> sets the maximum number of next words or word fragments each path can branch into at each step.</p>
            <p><strong className="text-zinc-200">Steps</strong> sets how far the tree grows. <strong className="text-zinc-200">Chains kept</strong> sets how many promising paths continue at each step. <strong className="text-zinc-200">Shortest chain</strong> sets the minimum length allowed to win; it can change the winner without changing the words already in the tree.</p>
          </div>
        </div>
      </section>

      {result && (
        <>
          <div
            className={`rounded-xl border px-4 py-3 max-w-4xl ${
              result.relation === "diverged"
                ? "border-law-bright/40 bg-law-bright/5"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            {result.min_length_binding && (
              <p className="text-xs text-law-gold/90 leading-relaxed mb-3">
                A shorter chain scored better and was not eligible —{" "}
                <span className="text-zinc-300">Shortest chain</span> is set to{" "}
                {result.min_length}. Drop it to see what it excluded.
              </p>
            )}
            <div className="space-y-1.5 font-mono text-xs">
              <ChainRow
                label="greedy"
                color="text-law-gold"
                text={result.greedy.text}
                cum={result.greedy.cum_prob}
                avg={result.greedy.avg_prob}
              />
              <ChainRow
                label="likeliest"
                color="text-law-bright"
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
              className="flex-1 min-w-40 max-w-md accent-law-light"
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

          {/* Place the legend directly under the diagram it labels. */}
          <p className="text-[11px] text-[var(--text-muted)] max-w-3xl leading-relaxed">
            ␣ marks a leading space, ⏎ a line break. The percentage under each token is its
            probability after temperature and the P/K filters, rescaled over the remaining
            candidates.
          </p>

        </>
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
        className="w-28 accent-law-light"
      />
    </label>
  );
}
