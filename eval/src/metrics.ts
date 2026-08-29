import type { AgentEvent } from "../../src/agent/events.js";
import type { RunMetrics } from "./types.js";

/**
 * Fold the events of one agent run into RunMetrics.
 *
 * Usage arrives on the terminal NDJSON message; when several usage events
 * appear (retries, sub-sessions) the last one carries the session totals.
 * Backends without usage parsing yield events with no usage entry — every
 * usage field then stays undefined and the report prints "n/a".
 */
export function collectMetrics(events: readonly AgentEvent[], elapsedMs: number): RunMetrics {
  const usage = [...events].reverse().find((e) => e.kind === "usage");
  if (!usage || usage.kind !== "usage") return { elapsedMs };
  return {
    elapsedMs,
    turns: usage.turns,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    costUsd: usage.costUsd,
  };
}

export interface Spread {
  median: number;
  min: number;
  max: number;
  /** How many runs actually reported the value. */
  n: number;
}

/** Spread over the defined values; undefined when nothing reported. */
export function spread(values: readonly (number | undefined)[]): Spread | undefined {
  const defined = values.filter((v): v is number => typeof v === "number");
  if (defined.length === 0) return undefined;
  const sorted = [...defined].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, min: sorted[0], max: sorted[sorted.length - 1], n: defined.length };
}

/** "median (min-max)" for the report tables; "n/a" when unreported. */
export function formatSpread(
  values: readonly (number | undefined)[],
  format: (n: number) => string = (n) => String(Math.round(n)),
): string {
  const s = spread(values);
  if (!s) return "n/a";
  const [med, min, max] = [format(s.median), format(s.min), format(s.max)];
  if (min === max) return med;
  return `${med} (${min}–${max})`;
}
