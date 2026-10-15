"use client";
import { useState } from "react";
export interface BuiltIn<C> { name: string; note?: string; config: C; badge?: string }
export function SetupBar<C extends Record<string, unknown>>({builtIns,blank,current,onLoad,intro,label="Start from"}:{kind:string;builtIns:BuiltIn<C>[];blank:C;current:C;onLoad:(config:C,name:string)=>void;intro?:React.ReactNode;hint?:React.ReactNode;label?:string}) {
  const [active,setActive]=useState(builtIns[0]?.name??"Blank");
  const choose=(name:string,config:C)=>{setActive(name);onLoad(config,name)};
  return <div className="space-y-1.5"><div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div><div className="flex flex-wrap gap-1.5">{builtIns.map(item=><button key={item.name} type="button" title={item.note} onClick={()=>choose(item.name,item.config)} className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${active===item.name?"border-law-bright/50 bg-law-bright/10 text-law-light":"border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"}`}>{item.name}{item.badge?<span className="ml-2 text-[9px] uppercase tracking-wide text-law-gold">{item.badge}</span>:null}</button>)}<button type="button" title="Empty every box and start from nothing" onClick={()=>choose("Blank",blank)} className={`rounded-lg border border-dashed px-3 py-1.5 text-xs transition-colors ${active==="Blank"?"border-law-bright/50 bg-law-bright/10 text-law-light":"border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-white"}`}>Blank</button></div>{intro}</div>
}
