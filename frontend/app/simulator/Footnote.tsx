"use client";

import { useState } from "react";

/**
 * Method note at the foot of a tab.
 *
 * Collapsed by default — nobody arrives wanting to read about tokenizers — but the
 * details matter the moment someone asks where a number came from, and they should be
 * on the page rather than in a conversation with whoever built it.
 */
export function Footnote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-8 border-t border-zinc-800 pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-[var(--text-muted)] hover:text-zinc-300 transition-colors"
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open && (
        <div className="mt-3 max-w-3xl space-y-3 text-[11px] text-[var(--text-muted)] leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

export function FnHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-zinc-300">{children}</p>;
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="text-zinc-200 font-mono">{children}</code>;
}

/**
 * Enumerated method notes.
 *
 * Several of these notes announce a count — "three causes, in order of frequency",
 * "two consequences", "two further limits" — and then run the items together in a
 * paragraph, so the reader has to do the separating the sentence promised. Numbering
 * them is the whole change: same words, same caveats, findable.
 *
 * Ordered where the text claims an order (frequency, importance), unordered where the
 * items are merely several.
 */
export function FnList({
  children,
  ordered = false,
}: {
  children: React.ReactNode;
  ordered?: boolean;
}) {
  const cls = `space-y-1.5 pl-4 marker:text-zinc-600 ${ordered ? "list-decimal" : "list-disc"}`;
  return ordered ? <ol className={cls}>{children}</ol> : <ul className={cls}>{children}</ul>;
}
