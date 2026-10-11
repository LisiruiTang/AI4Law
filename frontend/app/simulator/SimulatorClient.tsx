"use client";
import {useState} from "react";
import {TokenProbsPanel} from "./TokenProbsPanel";
import {BeamPanel} from "./BeamPanel";
import {SimulatorPremiseFootnote} from "./footnotes";
export function SimulatorClient(){
 const [mode,setMode]=useState<"probs"|"beam">("probs");
 const tabs=[["probs","Token probabilities"],["beam","Branching Tree"]] as const;
 return <div className="max-w-screen-xl px-6 py-10 mx-auto w-full">
  <div className="flex items-center gap-3 mb-5"><div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-xs font-bold tracking-wide text-violet-200">AI</div><h1 className="text-2xl font-bold text-white">Simulators</h1></div>
  <div className="mb-6 flex gap-1 border-b border-[var(--border)]">{tabs.map(([id,label])=><button key={id} onClick={()=>setMode(id)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${mode===id?"border-violet-500 text-violet-300":"border-transparent text-[var(--text-muted)] hover:text-zinc-300"}`}>{label}</button>)}</div>
  {mode==="beam"?<><p className="mb-1 max-w-3xl text-sm text-[var(--text-muted)]">How a model turns a probability distribution into words, and how much that choice changes what it writes.</p><p className="mb-8 max-w-3xl text-xs text-[var(--text-muted)] opacity-70">Keep the prompt fixed and compare low, medium, and high temperature directly in the Branching Tree. The displayed probabilities reflect the selected settings.</p><BeamPanel/><SimulatorPremiseFootnote/></>:<><p className="mb-1 max-w-3xl text-sm text-[var(--text-muted)]">Read the model&apos;s distribution over a set of answers, rather than the single word it happened to say.</p><p className="mb-8 max-w-3xl text-xs text-[var(--text-muted)] opacity-70">Add one line of instruction and watch the probability mass move.</p><TokenProbsPanel/><SimulatorPremiseFootnote/></>}
 </div>
}
