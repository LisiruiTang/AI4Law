"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getPortalSession, signOut, studentSignIn, type PortalSession } from "@/lib/portal";

export function AccessGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPortalSession().then(setSession).catch((e) => setError(e.message));
  }, []);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await studentSignIn(password);
      setPassword("");
      setSession(await getPortalSession());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    await signOut();
    setSession(await getPortalSession());
  }

  if (!session && !error) return <div className="mx-auto max-w-xl px-6 py-20 text-law-light">Opening simulator…</div>;
  if (!session) return <div className="mx-auto max-w-xl px-6 py-20 text-rose-300">{error}</div>;

  if (!session.access) {
    return (
      <main className="mx-auto max-w-md px-6 py-20">
        <h1 className="mb-2 text-2xl font-bold text-white">AI and Evidence Interpretation Lab</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">Enter the shared password to open the simulators.</p>
        <form onSubmit={unlock} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <label className="block text-sm text-law-light">Simulator password
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-white" />
          </label>
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          <button disabled={busy} className="rounded bg-law-bright px-4 py-2 font-semibold text-[#0d1725] disabled:opacity-60">
            {busy ? "Opening…" : "Open simulators"}
          </button>
        </form>
        <Link href="/admin" className="mt-5 inline-block text-sm text-law-light underline">Administrator sign in</Link>
      </main>
    );
  }

  return <>
    {session.role !== "public" && <div className="mx-auto max-w-screen-xl px-6 pt-3 text-right text-xs text-[var(--text-muted)]">
      {session.role === "admin" && <Link href="/admin" className="mr-4 text-law-light underline">Manage examples</Link>}
      <button onClick={leave} className="underline hover:text-white">Sign out</button>
    </div>}
    {children}
  </>;
}
