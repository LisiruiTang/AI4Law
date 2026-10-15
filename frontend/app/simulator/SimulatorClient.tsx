"use client";

import Image from "next/image";
import { useState } from "react";
import { TokenProbsPanel } from "./TokenProbsPanel";
import { BeamPanel } from "./BeamPanel";
import { SimulatorPremiseFootnote } from "./footnotes";

export function SimulatorClient() {
  const [mode, setMode] = useState<"probs" | "beam">("probs");
  const tabs = [["probs", "Token probabilities"], ["beam", "Branching Tree"]] as const;

  return (
    <div className="mx-auto w-full max-w-screen-xl px-6 py-10">
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-3 sm:items-baseline">
        <Image
          src="/columbia-law-logo-inline-white.svg"
          alt="Columbia Law School"
          width={220}
          height={20}
          priority
          className="h-auto w-[220px] max-w-full shrink-0"
        />
        <span className="hidden h-5 w-px self-center bg-law-dark sm:block" aria-hidden="true" />
        <h1 className="min-w-0 text-xl font-bold text-white">
          Simulators - AI and Evidence Interpretation Lab
        </h1>
      </div>

      <div className="mb-6 flex gap-1 border-b border-[var(--border)]">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === id
                ? "border-law-light text-law-light"
                : "border-transparent text-[var(--text-muted)] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "beam" ? (
        <>
          <p className="mb-1 max-w-3xl text-sm text-[var(--text-muted)]">
            How a model turns a probability distribution into words, and how much that choice changes what it writes.
          </p>
          <p className="mb-8 max-w-3xl text-xs text-[var(--text-muted)] opacity-70">
            Keep the prompt fixed and compare low, medium, and high temperature directly in the Branching Tree. The displayed probabilities reflect the selected settings.
          </p>
          <BeamPanel />
          <SimulatorPremiseFootnote />
        </>
      ) : (
        <>
          <p className="mb-1 max-w-3xl text-sm text-[var(--text-muted)]">
            Read the model&apos;s distribution over a set of answers, rather than the single word it happened to say.
          </p>
          <p className="mb-8 max-w-3xl text-xs text-[var(--text-muted)] opacity-70">
            Add one line of instruction and watch the probability mass move.
          </p>
          <TokenProbsPanel />
          <SimulatorPremiseFootnote />
        </>
      )}
    </div>
  );
}
