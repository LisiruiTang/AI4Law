"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { adminSignIn, getPortalSession, signOut, type PortalSession } from "@/lib/portal";
import { SimulatorClient } from "@/app/simulator/SimulatorClient";

const inputStyle = "mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-law-light";

export function AdminClient() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPortalSession().then(setSession).catch((e) => setError(e.message));
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminSignIn(username, password);
      setPassword("");
      setSession(await getPortalSession());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await signOut();
    setSession(await getPortalSession());
  }

  if (!session && !error) return <main className="mx-auto max-w-lg px-6 py-20 text-law-light">Opening administrator page…</main>;
  if (!session) return <main className="mx-auto max-w-lg px-6 py-20 text-rose-300">{error}</main>;

  if (session.role === "admin") return <SimulatorClient adminMode onAdminSignOut={logout} />;

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="mb-2 text-2xl font-bold text-white">Administrator sign in</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">Open the same simulators with controls to save shared examples.</p>
      <form onSubmit={login} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <label className="block text-sm text-law-light">Email or username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required className={inputStyle} />
        </label>
        <label className="block text-sm text-law-light">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className={inputStyle} />
        </label>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <button disabled={busy} className="rounded bg-law-bright px-4 py-2 font-semibold text-[#0d1725] disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <Link href="/simulator" className="mt-5 inline-block text-sm text-law-light underline">Back to simulator</Link>
    </main>
  );
}
