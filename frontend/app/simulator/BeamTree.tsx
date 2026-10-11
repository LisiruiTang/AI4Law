"use client";

import { useEffect, useMemo, useState } from "react";
import type { BeamResult, BeamNode } from "@/lib/api";

/**
 * The branching walk drawn as a trellis: one column per step, one node per candidate
 * token, edges weighted by how much probability the chain carries.
 *
 * Layout is a tidy tree rather than a ranked column, because the interesting thing is
 * ancestry — which early token opened onto which later ones. Children are ordered by
 * cumulative probability and parents sit at the midpoint of their children, so no
 * edges cross and a branch can be followed by eye from root to leaf.
 */

// SVG coordinates are absolute pixels, so they ignore the root font-size scale in
// globals.css. Read the same variable and apply it here, or the tree would stay
// small while the rest of the interface grew around it.
function uiScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const BASE_COL_W = 132;
const BASE_ROW_H = 26;
const BASE_PAD_X = 16;
const BASE_PAD_Y = 18;

interface Placed extends BeamNode {
  x: number;
  y: number;
}

/** Whitespace is invisible but meaningful — a token is " seen", not "seen", and
 *  newline tokens are real candidates the model often reaches for. */
function renderToken(token: string) {
  if (!token) return "▸";
  const shown = token.replace(/\n/g, "⏎").replace(/^ /, "␣");
  return shown.length > 12 ? shown.slice(0, 11) + "…" : shown;
}

/** A probability as a percentage that never claims more certainty than was measured.
 *
 * This read `(p * 100).toFixed(p < 0.1 ? 1 : 0)`, which rounds 0.9975 to "100%". On the
 * subword preset two consecutive steps displayed 100% — the model had said 99.75% and
 * 99.88%, and the panel rounded both up to a certainty it never expressed. The whole
 * point of the view is that the model holds a distribution rather than an answer, so a
 * node labelled 100% contradicts the thing it is there to show.
 *
 * Only an exact 1 prints "100%". Anything above 99.5% keeps a decimal so it cannot round
 * there, and small values keep one so they do not all collapse to "0%".
 */
function pct(p: number): string {
  if (p >= 1) return "100%";
  const v = p * 100;
  // Adding a decimal is not enough on its own: 99.999 rounds to "100.0%", which makes the
  // same false claim with more precision. Anything that would round to 100 at one decimal
  // gets the bound instead.
  if (v >= 99.95) return ">99.9%";
  // `>=`, not `>`. With `>` a probability of exactly 0.995 fell through to no decimals and
  // printed "100%" — the same defect one notch down, found by checking the boundary rather
  // than the examples either side of it.
  if (v >= 99.5) return `${v.toFixed(1)}%`;
  // A token the model all but ruled out is not impossible, and "0.0%" says it was.
  if (v > 0 && v < 0.05) return "<0.1%";
  return v < 10 ? `${v.toFixed(1)}%` : `${v.toFixed(0)}%`;
}

export function BeamTree({
  result,
  showPruned,
  maxStep,
}: {
  result: BeamResult;
  showPruned: boolean;
  maxStep: number;
}) {
  // SVG dimensions are resolved after mount to keep server and browser rendering aligned.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    setScale(uiScale());
  }, []);
  const COL_W = BASE_COL_W * scale;
  const ROW_H = BASE_ROW_H * scale;
  const PAD_X = BASE_PAD_X * scale;
  const PAD_Y = BASE_PAD_Y * scale;

  const { placed, width, height, edges } = useMemo(() => {
    const visible = result.nodes.filter(
      (n) => n.step <= maxStep && (showPruned || !n.pruned)
    );
    const byId = new Map(visible.map((n) => [n.id, n]));
    const children = new Map<number, BeamNode[]>();
    for (const n of visible) {
      if (n.parent === null) continue;
      if (!byId.has(n.parent)) continue;
      const list = children.get(n.parent) ?? [];
      list.push(n);
      children.set(n.parent, list);
    }
    for (const list of children.values()) {
      // Survivors above ghosts, then by probability: keeps the live tree readable
      // even when discarded branches are shown.
      list.sort((a, b) => Number(a.pruned) - Number(b.pruned) || b.cum_logprob - a.cum_logprob);
    }

    const pos = new Map<number, number>();
    let slot = 0;
    const assign = (node: BeamNode): number => {
      const kids = children.get(node.id) ?? [];
      if (kids.length === 0) {
        const y = slot++;
        pos.set(node.id, y);
        return y;
      }
      const ys = kids.map(assign);
      const y = (ys[0] + ys[ys.length - 1]) / 2;
      pos.set(node.id, y);
      return y;
    };
    const root = visible.find((n) => n.parent === null);
    if (root) assign(root);

    const placed: Placed[] = visible
      .filter((n) => pos.has(n.id))
      .map((n) => ({
        ...n,
        x: PAD_X + n.step * COL_W,
        y: PAD_Y + (pos.get(n.id) ?? 0) * ROW_H + ROW_H / 2,
      }));
    const placedById = new Map(placed.map((p) => [p.id, p]));

    const edges = placed
      .filter((p) => p.parent !== null && placedById.has(p.parent))
      .map((p) => ({ from: placedById.get(p.parent as number)!, to: p }));

    return {
      placed,
      edges,
      width: PAD_X * 2 + (maxStep + 1) * COL_W,
      height: PAD_Y * 2 + slot * ROW_H,
    };
  }, [result, showPruned, maxStep, COL_W, ROW_H, PAD_X, PAD_Y]);

  const bestIds = new Set(result.best.ids);
  const greedyIds = new Set(result.greedy.ids);

  const edgeStyle = (n: BeamNode) => {
    if (n.pruned) return { stroke: "#3f3f46", width: 1, dash: "3 3", opacity: 0.5 };
    const onBest = bestIds.has(n.id);
    const onGreedy = greedyIds.has(n.id);
    // Cumulative probability spans orders of magnitude; a log scale keeps late
    // branches visible instead of collapsing them all to hairlines.
    const w = 1 + Math.max(0, (12 + n.cum_logprob) / 12) * 4;
    if (onBest && onGreedy) return { stroke: "#a78bfa", width: w, dash: "", opacity: 0.95 };
    if (onBest) return { stroke: "#2dd4bf", width: w, dash: "", opacity: 0.95 };
    if (onGreedy) return { stroke: "#fbbf24", width: w, dash: "", opacity: 0.9 };
    return { stroke: "#52525b", width: w * 0.6, dash: "", opacity: 0.65 };
  };

  return (
    <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-950">
      <svg width={width} height={Math.max(height, 120 * scale)} className="block">
        {/* Step guides */}
        {Array.from({ length: maxStep + 1 }, (_, s) => (
          <g key={`col-${s}`}>
            <line
              x1={PAD_X + s * COL_W}
              y1={0}
              x2={PAD_X + s * COL_W}
              y2={height}
              stroke="#27272a"
              strokeWidth={1}
            />
            <text x={PAD_X + s * COL_W + 4 * scale} y={11 * scale} fill="#52525b" fontSize={9 * scale}>
              {s === 0 ? "prompt" : `step ${s}`}
            </text>
          </g>
        ))}

        {edges.map(({ from, to }) => {
          const st = edgeStyle(to);
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={`e-${to.id}`}
              d={`M ${from.x + 6 * scale} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 2 * scale} ${to.y}`}
              fill="none"
              stroke={st.stroke}
              strokeWidth={st.width}
              strokeDasharray={st.dash}
              opacity={st.opacity}
            />
          );
        })}

        {placed.map((n) => {
          if (n.step === 0) {
            return (
              <circle key={n.id} cx={n.x} cy={n.y} r={4 * scale} fill="#a78bfa" />
            );
          }
          const onBest = bestIds.has(n.id);
          const onGreedy = greedyIds.has(n.id);
          const color = n.pruned
            ? "#52525b"
            : onBest && onGreedy
              ? "#c4b5fd"
              : onBest
                ? "#5eead4"
                : onGreedy
                  ? "#fcd34d"
                  : "#a1a1aa";
          return (
            <g key={n.id} opacity={n.pruned ? 0.45 : 1}>
              <title>
                {[
                  JSON.stringify(n.token),
                  `this step: ${(n.prob * 100).toFixed(2)}% (rank ${n.rank + 1})`,
                  `chain so far: ${(n.cum_prob * 100).toFixed(4)}%`,
                  // How undecided the model was at the point this branch forked — shared by
                  // all siblings, since one distribution produced them. It is the figure that
                  // predicts whether greedy and the best sequence will part company at all,
                  // so it belongs where a reader is already looking at a branch point.
                  // Optional because a saved result from before 2026-10-02 has no entropy.
                  n.entropy === undefined
                    ? null
                    : `model's uncertainty here: ${n.entropy.toFixed(2)} bits` +
                      (n.captured_mass === undefined
                        ? ""
                        : ` (top 20 hold ${(n.captured_mass * 100).toFixed(1)}%)`),
                  n.pruned ? "\ndiscarded — outside the beam" : null,
                ]
                  .filter(Boolean)
                  .join("\n")}
              </title>
              <text
                x={n.x}
                y={n.y + 3 * scale}
                fill={color}
                fontSize={11 * scale}
                fontFamily="ui-monospace, monospace"
                fontWeight={onBest || onGreedy ? 600 : 400}
              >
                {renderToken(n.token)}
              </text>
              <text x={n.x} y={n.y + 13 * scale} fill="#52525b" fontSize={8 * scale}>
                {pct(n.prob)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
