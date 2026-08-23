import { formatSpread, spread } from "./metrics.js";
import type { ConditionId, EvalRunSummary, RunSpec, TaskHalf, TaskResult } from "./types.js";

/**
 * Base filename for a committed report, unique per run: two runs with the
 * same backend and model key on the same day must not overwrite each other,
 * so the run's start time is part of the name.
 * Example: "2026-08-22-103000-claude-medium".
 */
export function reportBaseName(spec: RunSpec): string {
  const stamp = spec.startedAt.slice(0, 19).replace("T", "-").replace(/:/g, "");
  return `${stamp}-${spec.backend}-${spec.modelKey}`;
}

/**
 * Render an EvalRunSummary as a markdown comparison report.
 *
 * The halves are reported separately on purpose: the defect half measures
 * whether known documentation defects mislead the agent (fix-verification);
 * only the neutral half supports the headline "does the corpus help" claim.
 * Aggregates show median (min-max) spread, never bare point estimates.
 */
export function generateReport(summary: EvalRunSummary): string {
  const { spec, results } = summary;
  const lines: string[] = [];

  lines.push("# Saaga paired eval report");
  lines.push("");
  lines.push(`- Revision: \`${spec.rev}\``);
  lines.push(`- Backend / model: ${spec.backend} / ${spec.model} (key: ${spec.modelKey})`);
  lines.push(`- Conditions: ${spec.conditions.join(", ")}`);
  lines.push(`- Repetitions per condition: ${spec.reps}`);
  lines.push(`- Tasks: ${spec.taskIds.length}`);
  lines.push(`- Started: ${spec.startedAt}${summary.finishedAt ? ` · Finished: ${summary.finishedAt}` : " · (incomplete run)"}`);
  lines.push("");
  if (spec.reps < 2) {
    lines.push(
      "> **Warning:** fewer than 2 repetitions per condition — no spread can be reported; " +
        "treat every number below as a single sample, not an estimate.",
    );
    lines.push("");
  }

  for (const half of ["neutral", "defect"] as const) {
    const halfResults = results.filter((r) => r.half === half);
    if (halfResults.length === 0) continue;
    lines.push(...renderHalf(half, halfResults, spec.conditions));
  }

  lines.push("## Per-rep detail");
  lines.push("");
  lines.push("| task | condition | rep | pass | exit | turns | tokens in | cache read | tokens out | docs reads | elapsed | note |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const r of results) {
    lines.push(
      `| ${r.taskId} | ${r.condition} | ${r.rep} | ${r.pass ? "✅" : "❌"} | ${r.exitCode} ` +
        `| ${num(r.metrics.turns)} | ${num(r.metrics.inputTokens)} | ${num(r.metrics.cacheReadTokens)} ` +
        `| ${num(r.metrics.outputTokens)} | ${num(r.metrics.docsReads)} ` +
        `| ${Math.round(r.metrics.elapsedMs / 1000)}s | ${note(r)} |`,
    );
  }
  lines.push("");
  lines.push("Raw data: `summary.json` next to this report regenerates every table above.");
  lines.push("");
  return lines.join("\n");
}

function renderHalf(
  half: TaskHalf,
  results: TaskResult[],
  conditions: ConditionId[],
): string[] {
  const lines: string[] = [];
  const title =
    half === "neutral"
      ? "## Neutral half (headline: does the corpus help?)"
      : "## Defect half (fix-verification of known doc defects)";
  lines.push(title);
  lines.push("");

  const taskIds = [...new Set(results.map((r) => r.taskId))];

  lines.push(`| task | ${conditions.join(" | ")} |`);
  lines.push(`|---|${conditions.map(() => "---").join("|")}|`);
  for (const taskId of taskIds) {
    const cells = conditions.map((condition) => {
      const runs = results.filter((r) => r.taskId === taskId && r.condition === condition);
      if (runs.length === 0) return "–";
      return `${runs.filter((r) => r.pass).length}/${runs.length}`;
    });
    lines.push(`| ${taskId} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("| condition | success | turns | tokens in | cache read | tokens out | corpus opened | elapsed |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const condition of conditions) {
    const runs = results.filter((r) => r.condition === condition);
    const passed = runs.filter((r) => r.pass).length;
    lines.push(
      `| ${condition} | ${passed}/${runs.length} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.turns))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.inputTokens))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.cacheReadTokens))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.outputTokens))} ` +
        `| ${corpusOpened(runs)} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.elapsedMs), (n) => `${Math.round(n / 1000)}s`)} |`,
    );
  }
  lines.push("");
  return lines;
}

/** "k/n runs" whose transcript shows at least one corpus-file open. */
function corpusOpened(runs: TaskResult[]): string {
  const measured = runs.filter((r) => typeof r.metrics.docsReads === "number");
  if (measured.length === 0) return "n/a";
  const opened = measured.filter((r) => (r.metrics.docsReads ?? 0) > 0).length;
  return `${opened}/${measured.length} runs`;
}

/**
 * Render a delta report between two runs of the SAME pre-registered task
 * set — the regeneration-milestone instrument (old corpus vs new corpus).
 *
 * Refuses to compare runs whose task sets differ: comparability requires
 * identical tasks and checks, so a changed set means re-running both sides.
 * Conditions are compared over their intersection.
 */
export function generateComparison(base: EvalRunSummary, candidate: EvalRunSummary): string {
  if (base.spec.taskSetVersion !== candidate.spec.taskSetVersion) {
    throw new Error(
      `task-set versions differ (base: ${String(base.spec.taskSetVersion)}, candidate: ${String(candidate.spec.taskSetVersion)}) — ` +
        "a version bump changes prompts/checks/stubs, so both sides must be re-run at the same version",
    );
  }
  const baseTasks = [...base.spec.taskIds].sort().join(",");
  const candTasks = [...candidate.spec.taskIds].sort().join(",");
  if (baseTasks !== candTasks) {
    throw new Error(
      "task sets differ between runs — comparison requires the identical pre-registered task set (re-run both sides after any task change)",
    );
  }
  const conditions = base.spec.conditions.filter((c) => candidate.spec.conditions.includes(c));
  if (conditions.length === 0) {
    throw new Error("the runs share no condition to compare");
  }

  const lines: string[] = [];
  lines.push("# Saaga paired eval comparison");
  lines.push("");
  lines.push(`- Base: rev \`${base.spec.rev}\` · ${base.spec.backend}/${base.spec.model} · ${base.spec.startedAt}`);
  lines.push(`- Candidate: rev \`${candidate.spec.rev}\` · ${candidate.spec.backend}/${candidate.spec.model} · ${candidate.spec.startedAt}`);
  lines.push(`- Tasks: ${base.spec.taskIds.length} (identical sets) · Conditions compared: ${conditions.join(", ")}`);
  if (base.spec.backend !== candidate.spec.backend || base.spec.model !== candidate.spec.model) {
    lines.push("");
    lines.push("> **Warning:** backend/model differ between runs — deltas mix corpus and model effects.");
  }
  lines.push("");

  lines.push("## Success (base → candidate)");
  lines.push("");
  lines.push("| half | condition | base | candidate | Δ passes |");
  lines.push("|---|---|---|---|---:|");
  for (const half of ["neutral", "defect"] as const) {
    for (const condition of conditions) {
      const b = pick(base, half, condition);
      const c = pick(candidate, half, condition);
      if (b.length === 0 && c.length === 0) continue;
      const bp = b.filter((r) => r.pass).length;
      const cp = c.filter((r) => r.pass).length;
      lines.push(
        `| ${half} | ${condition} | ${bp}/${b.length} | ${cp}/${c.length} | ${signed(cp - bp)} |`,
      );
    }
  }
  lines.push("");

  const flips: string[] = [];
  for (const taskId of base.spec.taskIds) {
    for (const condition of conditions) {
      const b = base.results.filter((r) => r.taskId === taskId && r.condition === condition);
      const c = candidate.results.filter((r) => r.taskId === taskId && r.condition === condition);
      const bp = b.filter((r) => r.pass).length;
      const cp = c.filter((r) => r.pass).length;
      if (b.length > 0 && c.length > 0 && bp * c.length !== cp * b.length) {
        flips.push(`| ${taskId} | ${condition} | ${bp}/${b.length} | ${cp}/${c.length} |`);
      }
    }
  }
  lines.push("## Task-level changes");
  lines.push("");
  if (flips.length === 0) {
    lines.push("No task changed its pass rate in any compared condition.");
  } else {
    lines.push("| task | condition | base | candidate |");
    lines.push("|---|---|---|---|");
    lines.push(...flips);
  }
  lines.push("");

  lines.push("## Cost medians (base → candidate)");
  lines.push("");
  lines.push("| condition | turns | cache read | tokens out | elapsed | corpus opened (base → cand) |");
  lines.push("|---|---|---|---|---|---|");
  for (const condition of conditions) {
    const b = base.results.filter((r) => r.condition === condition);
    const c = candidate.results.filter((r) => r.condition === condition);
    lines.push(
      `| ${condition} ` +
        `| ${medianDelta(b, c, (m) => m.turns)} ` +
        `| ${medianDelta(b, c, (m) => m.cacheReadTokens)} ` +
        `| ${medianDelta(b, c, (m) => m.outputTokens)} ` +
        `| ${medianDelta(b, c, (m) => m.elapsedMs, (n) => `${Math.round(n / 1000)}s`)} ` +
        `| ${corpusOpened(b)} → ${corpusOpened(c)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function pick(summary: EvalRunSummary, half: TaskHalf, condition: ConditionId): TaskResult[] {
  return summary.results.filter((r) => r.half === half && r.condition === condition);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function medianDelta(
  base: TaskResult[],
  candidate: TaskResult[],
  select: (m: TaskResult["metrics"]) => number | undefined,
  format: (n: number) => string = (n) => String(Math.round(n)),
): string {
  const b = spread(base.map((r) => select(r.metrics)));
  const c = spread(candidate.map((r) => select(r.metrics)));
  if (!b || !c) return "n/a";
  const pct = b.median > 0 ? ` (${signed(Math.round(((c.median - b.median) / b.median) * 100))}%)` : "";
  return `${format(b.median)} → ${format(c.median)}${pct}`;
}

function num(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "n/a";
}

function note(r: TaskResult): string {
  const text = r.error ? `error: ${r.error}` : (r.checkDetail ?? "");
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
}
