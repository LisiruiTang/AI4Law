"use client";

import { useEffect, useRef, useState } from "react";
import { ProbeUnavailable } from "./ProbeUnavailable";
import { SetupBar, type BuiltIn } from "./SetupBar";
import { AdminExampleEditor } from "./AdminExampleEditor";
import { fetchExamples, type PortalExample } from "@/lib/portal";
import {
  fetchProbeAvailability,
  probeClassify,
  probeCompare,
  type ProbeAvailability,
  type TokenProbResult,
  type TokenProbComparison,
} from "@/lib/api";

/**
 * Reads the model's distribution over a set of labels instead of the one word it
 * sampled — the API equivalent of TokenProbs' logit extraction.
 *
 * The presets steer toward GRADED label sets on purpose. Instruction-tuned models
 * saturate on categorical judgments: ask "yes / partly / no" and you get 100% on one
 * of them, which hides the very effect this is meant to reveal. Ask for a 1-5 score
 * and the mass spreads across adjacent values, so a change in the prompt becomes
 * visible as movement.
 */

type Mode = "single" | "context" | "versions" | "models";

interface Preset {
  name: string;
  /** Persona and behaviour. Optional — with none, you measure the model's own disposition. */
  persona: string;
  /** What the model is actually asked. */
  question: string;
  /** Comma-separated answer options. */
  options: string;
  mode: Mode;
  contextA?: string;
  contextB?: string;
  labelA?: string;
  labelB?: string;
  modelB?: string;
  /** Used only to mark a preset as a control in the example selector. */
  expect?: "shift" | "null";
  /** Optional note displayed with the preset. */
  expectNote?: string;
}

/** What a saved token-probability setup carries. Inputs only. */
export interface TokenProbsConfig extends Record<string, unknown> {
  persona: string;
  question: string;
  options: string;
  mode: Mode;
  contextA: string;
  contextB: string;
  labelA: string;
  labelB: string;
  modelB: string;
}

const EMPTY: TokenProbsConfig = {
  persona: "",
  question: "",
  options: "",
  mode: "single",
  contextA: "",
  contextB: "",
  labelA: "Context on",
  labelB: "Context off",
  modelB: "gpt-4o",
};

function toConfig(p: Preset): TokenProbsConfig {
  return {
    persona: p.persona,
    question: p.question,
    options: p.options,
    mode: p.mode,
    contextA: p.contextA ?? "",
    contextB: p.contextB ?? "",
    labelA: p.labelA ?? "Context on",
    labelB: p.labelB ?? "Context off",
    modelB: p.modelB ?? "gpt-4o",
  };
}

const BLANK: Preset = {
  name: "Blank",
  persona: "",
  question: "",
  options: "",
  mode: "single",
};

function Bars({
  distribution,
  deltas,
  accent = "teal",
}: {
  distribution: Record<string, number>;
  deltas?: Record<string, number>;
  accent?: "teal" | "sky";
}) {
  const bar = accent === "teal" ? "bg-law-bright/70" : "bg-law-gold/70";
  return (
    <div className="space-y-1.5">
      {Object.entries(distribution).map(([label, p]) => {
        const d = deltas?.[label];
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="w-36 sm:w-44 shrink-0 break-words text-[11px] leading-tight text-zinc-400" title={label}>
              {label}
            </span>
            <div className="flex-1 h-4 rounded bg-zinc-800/70 overflow-hidden">
              <div className={`h-full ${bar} rounded`} style={{ width: `${Math.max(p * 100, 0.4)}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-zinc-300">
              {(p * 100).toFixed(1)}%
            </span>
            {d !== undefined && (
              <span
                className={`w-14 shrink-0 text-right text-[11px] tabular-nums ${
                  Math.abs(d) < 0.005
                    ? "text-zinc-600"
                    : d > 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                }`}
              >
                {d > 0 ? "+" : ""}
                {(d * 100).toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TokenProbsPanel({ adminMode = false }: { adminMode?: boolean }) {
  const [status, setStatus] = useState<ProbeAvailability | null>(null);
  const models = status?.models ?? [];
  const [model, setModel] = useState("gpt-4o-mini");

  const [persona, setPersona] = useState(BLANK.persona);
  const [question, setQuestion] = useState(BLANK.question);
  const [optionsRaw, setOptionsRaw] = useState(BLANK.options);
  const optionsBox = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>(BLANK.mode);
  const [contextA, setContextA] = useState("");
  const [contextB, setContextB] = useState("");
  const [labelA, setLabelA] = useState("Context on");
  const [labelB, setLabelB] = useState("Context off");
  const [modelB, setModelB] = useState("gpt-4o");

  const [presets, setPresets] = useState<Preset[]>([]);
  const [examples, setExamples] = useState<PortalExample<TokenProbsConfig>[]>([]);
  const [selectedExample, setSelectedExample] = useState<PortalExample<TokenProbsConfig> | null>(null);
  const [presetError, setPresetError] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [single, setSingle] = useState<TokenProbResult | null>(null);
  const [comparison, setComparison] = useState<TokenProbComparison | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    fetchProbeAvailability().then((a) => {
      setStatus(a);
      if (a.models.length && !a.models.includes(model)) setModel(a.models[0]);
      if (a.models.length && !a.models.includes(modelB)) {
        setModelB(a.models[Math.min(1, a.models.length - 1)]);
      }
    });
  }, [model, modelB]);

  useEffect(() => {
    void reloadExamples().catch((e) => setPresetError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function reloadExamples(selectId?: number) {
    const rows = await fetchExamples<TokenProbsConfig>("token");
    setExamples(rows);
    const loaded = rows.map((row): Preset => ({ ...row.config, name: row.name }));
    setPresets(loaded);
    const selected = rows.find((row) => row.id === selectId) ?? rows[0] ?? null;
    setSelectedExample(selected);
    if (selected) load(selected.config);
    else load(EMPTY);
    setPresetError("");
  }

  const options = optionsRaw
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  useEffect(() => {
    const box = optionsBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [optionsRaw]);

  /** Put a config into the form, whether it came from a built-in or a saved row. */
  function load(c: TokenProbsConfig) {
    setPersona(c.persona ?? "");
    setQuestion(c.question ?? "");
    setOptionsRaw(c.options ?? "");
    setMode((c.mode as Mode) ?? "single");
    setContextA(c.contextA ?? "");
    setContextB(c.contextB ?? "");
    setLabelA(c.labelA ?? "Context on");
    setLabelB(c.labelB ?? "Context off");
    if (c.modelB) setModelB(c.modelB);
    setSingle(null);
    setComparison(null);
    setError(null);
  }

  async function run() {
    if (options.length < 2 || !question.trim()) return;
    setRunning(true);
    setError(null);
    setSingle(null);
    setComparison(null);
    try {
      if (mode === "single") {
        setSingle(await probeClassify({
          text: question, labels: options, instruction: persona, model,
        }));
      } else {
        setComparison(
          await probeCompare({
            text: question,
            labels: options,
            instruction: persona,
            // In models mode the context is held constant across both arms, so it is
            // sent once and applies to each. Everything else that differs is refused
            // by the probe rather than silently producing an unattributable number.
            block_text: contextA,
            block_text_b:
              mode === "versions" && contextB.trim() ? contextB : undefined,
            model,
            model_b: mode === "models" ? modelB : undefined,
          })
        );
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  }

  if (status && !status.available && !adminMode) {
    return <ProbeUnavailable status={status} />;
  }

  const result = comparison?.on ?? single;

  return (
    <div>
      {presetError && <p role="alert" className="mb-4 text-sm text-rose-300">Could not load examples: {presetError}</p>}
      {adminMode && status && !status.available && <ProbeUnavailable status={status} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controls */}
      <div className="space-y-4">
        <SetupBar<TokenProbsConfig>
          kind="token_probs"
          selectedName={adminMode ? selectedExample?.name ?? "Blank" : undefined}
          builtIns={presets.map((p): BuiltIn<TokenProbsConfig> => ({
            name: p.name,
            note: p.expectNote,
            config: toConfig(p),
            badge: p.expect === "null" ? "control" : undefined,
          }))}
          blank={EMPTY}
          current={{
            persona, question, options: optionsRaw, mode,
            contextA, contextB, labelA, labelB, modelB,
          }}
          onLoad={(config, name) => {
            const selected = examples.find((row) => row.name === name) ?? null;
            setSelectedExample(selected);
            load(config);
          }}
        />

        {adminMode && <AdminExampleEditor<TokenProbsConfig>
          key={selectedExample?.id ?? "blank"}
          kind="token" selected={selectedExample}
          current={{ persona, question, options: optionsRaw, mode, contextA, contextB, labelA, labelB, modelB }}
          reload={reloadExamples}
        />}

        {/* "1 · Persona and behaviour" removed per Rebecca/Aaron 2026-10-06.
            Students use the optional context box at the bottom instead. */}

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            1 · What you are asking it
          </span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="The case, the student answer, the passage — whatever the model must judge. This is the user turn."
            className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-law-bright"
          />
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            2 · Answer options{" "}
            <span className="text-zinc-600 normal-case tracking-normal">(comma separated)</span>
          </span>
          <textarea
            ref={optionsBox}
            value={optionsRaw}
            onChange={(e) => setOptionsRaw(e.target.value)}
            rows={3}
            placeholder="1, 2, 3, 4, 5"
            className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-law-bright"
          />
        </label>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 space-y-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              3 · What to compare
            </div>
            <div className="grid grid-cols-1 gap-1">
              {([
                ["single", "Just one run", "Read the shape of a single distribution — how spread or certain the model is — with nothing to compare it against."],
                ["context", "One context, on and off", "The everyday question: does this guardrail, rubric line or instruction actually change the answer?"],
                ["versions", "Two different contexts", "When silence is the wrong counterfactual — an old policy against its replacement, a strict rubric against a lenient one, on identical input."],
                ["models", "Two models, same everything", "Model choice is a design decision usually made on price and habit. Hold the persona, question, options and context constant, and see what the choice costs you."],
              ] as const).map(([id, label, why]) => (
                <label
                  key={id}
                  className={`flex gap-2 items-start cursor-pointer rounded-lg px-2 py-1.5 border transition-colors ${
                    mode === id
                      ? "border-law-bright/40 bg-law-bright/10"
                      : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <input
                    type="radio"
                    name="cmp-mode"
                    checked={mode === id}
                    onChange={() => setMode(id)}
                    className="accent-law-bright mt-0.5"
                  />
                  <span>
                    <span className={`block text-xs ${mode === id ? "text-law-light" : "text-zinc-300"}`}>
                      {label}
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)] leading-relaxed">
                      {why}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {mode !== "single" && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-law-bright">
                {mode === "models" ? "Context — used by both models (optional)" : labelA}
              </div>
              <textarea
                value={contextA}
                onChange={(e) => setContextA(e.target.value)}
                rows={3}
                placeholder={
                  mode === "context"
                    ? "The guardrail, rubric line or rule to add — then remove…"
                    : mode === "versions"
                      ? "The first of the two contexts…"
                      : "Held constant across both models. Leave empty to compare them with no context at all."
                }
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-law-bright"
              />
            </div>
          )}

          {mode === "versions" && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-law-gold">
                {labelB}
              </div>
              <textarea
                value={contextB}
                onChange={(e) => setContextB(e.target.value)}
                rows={3}
                placeholder="The other context, on identical input…"
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-law-gold"
              />
            </div>
          )}

          {mode === "models" && (
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-law-gold mb-1">
                Second model
              </span>
              <select
                value={modelB}
                onChange={(e) => setModelB(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300"
              >
                {(models.length ? models : [modelB]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {modelB === model && (
                <p className="mt-1 text-[10px] text-law-gold/80">
                  That is the same model as the one below — pick a different one, or
                  there is nothing to compare.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={running || options.length < 2 || !question.trim()}
            className="px-4 py-2 text-xs rounded-lg bg-law-bright/20 border border-law-bright/40 text-law-light hover:bg-law-bright/30 disabled:opacity-40 transition-colors"
          >
            {running ? "Measuring…" : mode === "single" ? "Measure" : "Measure both ways"}
          </button>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[11px] text-zinc-300"
          >
            {(models.length ? models : [model]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-[var(--text-muted)]">
            1 token per call
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Results — pinned, because the Run button is at the BOTTOM of a controls
          column that is roughly twice as tall as this one. Without this, clicking
          Run puts the answer somewhere above the fold and the reader has to scroll
          back up to find out what happened, every single run. The measurement is the
          point of the panel; it should not be the part you have to go looking for.

          `self-start` is load-bearing. A grid item stretches to the row height by
          default, and a stretched item has no free space to stick within — position
          sticky silently does nothing. The other three panels have no controls/
          results split, so this is the only place it applies.

          `top-20` clears the sticky nav, which condenses on scroll — which is
          exactly when this matters. Capped and scrollable so a long distribution
          scrolls inside its own column instead of running off the screen. */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
        {comparison && (
          <>
            {/* HEADINGS COME FROM THE RUN, NOT THE FORM.
                Two reasons, and both were bugs. A model-versus-model run put the
                CONTEXT labels over the bars — "Context on" / "Context off" above two
                arms that shared one context and differed only in which model
                answered, which is a caption describing the wrong experiment. And
                reading live state meant editing a label after a run silently
                relabelled a result already on screen.

                `comparison.mode` is what the server actually ran, so the caption
                cannot drift from the measurement it sits above. */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-law-bright mb-1.5">
                {comparison.mode === "models"
                  ? (comparison.model_a ?? "First model")
                  : labelA}
              </div>
              <Bars distribution={comparison.on.distribution} deltas={comparison.deltas} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-law-gold mb-1.5">
                {comparison.mode === "models"
                  ? (comparison.model_b ?? "Second model")
                  : labelB}
              </div>
              <Bars distribution={comparison.off.distribution} accent="sky" />
            </div>
          </>
        )}

        {single && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-law-bright mb-1.5">
              Distribution
            </div>
            <Bars distribution={single.distribution} />
          </div>
        )}

        {result && (
          <>
            {result.collisions.length > 0 && (
              <div className="rounded-lg border border-law-gold/30 bg-law-gold/10 px-3 py-2 text-[11px] text-law-gold leading-relaxed">
                {result.collisions.map((c) => c.join(" / ")).join("; ")} share a leading
                token and cannot be distinguished from one position. Choose labels that
                differ at the first character.
              </div>
            )}

            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[11px] text-[var(--text-muted)] hover:text-white transition-colors"
            >
              {showRaw ? "Hide" : "Show"} the raw next-token candidates →
            </button>
            {showRaw && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[10px] text-zinc-400 space-y-0.5">
                <div className="text-zinc-600 mb-1">
                  top candidates at the answer position, before restricting to your labels
                </div>
                {result.raw_top_tokens.map((t, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-zinc-300">{JSON.stringify(t.token)}</span>
                    <span className="tabular-nums">
                      {t.prob < 0.0001 ? t.prob.toExponential(1) : (t.prob * 100).toFixed(2) + "%"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
