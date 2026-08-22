import { describe, expect, test } from "vitest";
import { collectMetrics, formatSpread, spread } from "./src/metrics.js";
import { generateReport, reportBaseName } from "./src/report-gen.js";
import type { EvalRunSummary, RunMetrics, TaskResult } from "./src/types.js";

describe("metrics", () => {
  test("collectMetrics folds the last usage event", () => {
    const metrics = collectMetrics(
      [
        { kind: "session", tools: ["Read"] },
        { kind: "usage", turns: 2, inputTokens: 10, outputTokens: 5 },
        { kind: "usage", turns: 6, inputTokens: 100, outputTokens: 50, costUsd: 0.02 },
      ],
      1234,
    );
    expect(metrics).toEqual({
      elapsedMs: 1234,
      turns: 6,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined,
      costUsd: 0.02,
    });
  });

  test("collectMetrics without usage events keeps only elapsed", () => {
    expect(collectMetrics([{ kind: "session", tools: [] }], 500)).toEqual({ elapsedMs: 500 });
  });

  test("spread reports median/min/max over defined values only", () => {
    expect(spread([3, undefined, 1, 2])).toEqual({ median: 2, min: 1, max: 3, n: 3 });
    expect(spread([4, 2])).toEqual({ median: 3, min: 2, max: 4, n: 2 });
    expect(spread([undefined])).toBeUndefined();
  });

  test("formatSpread renders median (min-max) and n/a", () => {
    expect(formatSpread([1200, 1800])).toBe("1500 (1200–1800)");
    expect(formatSpread([7, 7])).toBe("7");
    expect(formatSpread([undefined])).toBe("n/a");
  });
});

describe("generateReport", () => {
  function result(over: Partial<TaskResult> & Pick<TaskResult, "taskId" | "half">): TaskResult {
    const metrics: RunMetrics = over.metrics ?? { elapsedMs: 10_000, turns: 5, inputTokens: 1000, outputTokens: 200 };
    return {
      condition: "no-docs",
      rep: 1,
      exitCode: 0,
      pass: true,
      logFile: "logs/x.ndjson",
      ...over,
      metrics,
    };
  }

  const summary: EvalRunSummary = {
    schemaVersion: 1,
    spec: {
      schemaVersion: 1,
      backend: "claude",
      model: "sonnet",
      modelKey: "medium",
      rev: "abc1234",
      conditions: ["no-docs", "saaga-docs"],
      reps: 2,
      taskIds: ["neutral/a", "defect/b"],
      startedAt: "2026-08-22T10:00:00.000Z",
    },
    results: [
      result({ taskId: "neutral/a", half: "neutral", condition: "no-docs", rep: 1, pass: false }),
      result({ taskId: "neutral/a", half: "neutral", condition: "no-docs", rep: 2, pass: false, checkDetail: "expected match missing: /x/" }),
      result({ taskId: "neutral/a", half: "neutral", condition: "saaga-docs", rep: 1 }),
      result({ taskId: "neutral/a", half: "neutral", condition: "saaga-docs", rep: 2 }),
      result({ taskId: "defect/b", half: "defect", condition: "no-docs", rep: 1 }),
      result({ taskId: "defect/b", half: "defect", condition: "no-docs", rep: 2, pass: false, error: "timeout" }),
      result({ taskId: "defect/b", half: "defect", condition: "saaga-docs", rep: 1 }),
      result({ taskId: "defect/b", half: "defect", condition: "saaga-docs", rep: 2 }),
    ],
    finishedAt: "2026-08-22T11:00:00.000Z",
  };

  test("renders both halves separately with per-condition fractions", () => {
    const report = generateReport(summary);
    expect(report).toContain("## Neutral half");
    expect(report).toContain("## Defect half");
    // Neutral half: no-docs fails both reps, saaga-docs passes both.
    expect(report).toContain("| neutral/a | 0/2 | 2/2 |");
    expect(report).toContain("| defect/b | 1/2 | 2/2 |");
    // The neutral heading comes first: it carries the headline claim.
    expect(report.indexOf("## Neutral half")).toBeLessThan(report.indexOf("## Defect half"));
  });

  test("aggregates show spread, not point estimates", () => {
    const report = generateReport(summary);
    // Aggregates are per half: the neutral half's no-docs arm failed 2/2.
    expect(report).toMatch(/\| no-docs \| 0\/2 \| 5 \| 1000 \| 200 \| 10s \|/);
    expect(report).toMatch(/\| no-docs \| 1\/2 \| 5 \| 1000 \| 200 \| 10s \|/);
    expect(report).toContain("## Per-rep detail");
    expect(report).toContain("error: timeout");
  });

  test("report base names are unique per run, not per day", () => {
    const morning = reportBaseName(summary.spec);
    const evening = reportBaseName({
      ...summary.spec,
      startedAt: "2026-08-22T18:30:15.000Z",
    });
    expect(morning).toBe("2026-08-22-100000-claude-medium");
    expect(evening).toBe("2026-08-22-183015-claude-medium");
    expect(morning).not.toBe(evening);
  });

  test("warns when reps < 2", () => {
    const single: EvalRunSummary = {
      ...summary,
      spec: { ...summary.spec, reps: 1 },
    };
    expect(generateReport(single)).toContain("fewer than 2 repetitions");
    expect(generateReport(summary)).not.toContain("fewer than 2 repetitions");
  });
});
