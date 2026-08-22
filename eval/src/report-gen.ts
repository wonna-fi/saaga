import { formatSpread } from "./metrics.js";
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
  lines.push("| task | condition | rep | pass | exit | turns | tokens in | tokens out | elapsed | note |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---|");
  for (const r of results) {
    lines.push(
      `| ${r.taskId} | ${r.condition} | ${r.rep} | ${r.pass ? "✅" : "❌"} | ${r.exitCode} ` +
        `| ${num(r.metrics.turns)} | ${num(r.metrics.inputTokens)} | ${num(r.metrics.outputTokens)} ` +
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

  lines.push("| condition | success | turns | tokens in | tokens out | elapsed |");
  lines.push("|---|---|---|---|---|---|");
  for (const condition of conditions) {
    const runs = results.filter((r) => r.condition === condition);
    const passed = runs.filter((r) => r.pass).length;
    lines.push(
      `| ${condition} | ${passed}/${runs.length} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.turns))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.inputTokens))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.outputTokens))} ` +
        `| ${formatSpread(runs.map((r) => r.metrics.elapsedMs), (n) => `${Math.round(n / 1000)}s`)} |`,
    );
  }
  lines.push("");
  return lines;
}

function num(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "n/a";
}

function note(r: TaskResult): string {
  const text = r.error ? `error: ${r.error}` : (r.checkDetail ?? "");
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
}
