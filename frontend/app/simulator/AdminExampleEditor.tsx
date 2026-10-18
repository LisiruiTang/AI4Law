"use client";

import { useEffect, useState } from "react";
import {
  addExample, PortalError, removeExample, saveExample,
  type ExampleKind, type PortalExample,
} from "@/lib/portal";

export function AdminExampleEditor<C extends Record<string, unknown>>({
  kind, selected, current, reload,
}: {
  kind: ExampleKind;
  selected: PortalExample<C> | null;
  current: C;
  reload: (selectId?: number) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(selected?.name ?? "");
    setNote(selected?.note ?? "");
  }, [selected?.id, selected?.version]);

  async function save() {
    if (!name.trim()) {
      setError("Give this example a name before saving.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Preserve stored metadata such as a token example's stated expectation.
      const config = selected ? { ...selected.config, ...current } : current;
      const saved = selected
        ? await saveExample({ ...selected, name, note, config })
        : await addExample({ kind, name, note, config });
      await reload(saved.id);
      setMessage("Saved. Students will see this example when they reload.");
    } catch (e) {
      if (e instanceof PortalError && e.status === 409) {
        setError(`${e.message} Your edits are still here. Choose Reload latest before saving again.`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete “${selected.name}” from student examples?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await removeExample(selected.id, selected.version);
      await reload();
      setMessage("Example deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Save example" className="rounded-lg border border-law-light/40 bg-law-light/5 p-3 text-xs text-law-light">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{selected ? "Edit this example" : "New example"}</span>
        {selected && <button type="button" disabled={busy} onClick={() => void reload(selected.id).then(() => { setError(""); setMessage(""); }).catch((e) => setError(String(e)))}
          className="underline disabled:opacity-50">Reload latest</button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="Example name" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-white" />
        </label>
        <label className="block">Short note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-white" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()}
          className="rounded bg-law-light px-4 py-1.5 font-semibold text-[#0d1725] disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        {selected && <button type="button" disabled={busy} onClick={() => void remove()}
          className="text-rose-300 underline disabled:opacity-50">Delete</button>}
        <span className="text-[var(--text-muted)]">Edits stay in this browser until you select Save. Choose Blank to add an example.</span>
      </div>
      {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
      {message && <p role="status" className="mt-2">{message}</p>}
    </section>
  );
}
