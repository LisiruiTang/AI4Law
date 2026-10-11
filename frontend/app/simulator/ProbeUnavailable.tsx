"use client";

import type { ProbeAvailability } from "@/lib/api";

/**
 * Says which of the four things is actually wrong.
 *
 * These panels used to print "needs an OpenAI key" whenever anything failed, so a
 * backend that was unreachable, one running an older build, and one genuinely missing
 * the key all looked the same — and only one of those is fixed by adding a key.
 */
const HEADLINES: Record<string, string> = {
  no_key: "The backend has no OpenAI or OpenRouter key",
  old_backend: "The backend is running an older build",
  unreachable: "This page cannot reach the backend",
  server_error: "The backend returned an error",
};

export function ProbeUnavailable({ status }: { status: ProbeAvailability }) {
  const headline = HEADLINES[status.problem] ?? "Probes are unavailable";

  return (
    <div className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <p className="font-semibold mb-1.5">{headline}</p>
      <p className="text-xs leading-relaxed text-amber-200/85">{status.reason}</p>

      {status.problem === "no_key" && (
        <p className="text-xs leading-relaxed text-amber-200/70 mt-2">
          These probes need token log-probabilities. Add OPENAI_API_KEY or OPENROUTER_API_KEY
          to the backend environment, then restart the service. Anthropic does not return
          log-probabilities for these measurements.
        </p>
      )}

      {status.problem !== "no_key" && (
        <p className="text-xs leading-relaxed text-amber-200/70 mt-2">
          Tried <code className="text-amber-100">{status.endpoint}</code>. Opening that URL
          directly will show whether the backend is up and whether it has the route.
        </p>
      )}
    </div>
  );
}
