import { describe, expect, test } from "vitest";
import { collectMetrics, formatSpread, spread } from "./src/metrics.js";
import { generateComparison, generateReport, reportBaseName } from "./src/report-gen.js";
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
    const metrics: RunMetrics = over.metrics ?? {
      elapsedMs: 10_000,
      turns: 5,
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 50_000,
      docsReads: 2,
    };
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

  test("aggregates show spread, cache-read context, and corpus usage", () => {
    const report = generateReport(summary);
    // Aggregates are per half: the neutral half's no-docs arm failed 2/2.
    expect(report).toMatch(/\| no-docs \| 0\/2 \| 5 \| 1000 \| 50000 \| 200 \| 2\/2 runs \| 10s \|/);
    expect(report).toMatch(/\| no-docs \| 1\/2 \| 5 \| 1000 \| 50000 \| 200 \| 2\/2 runs \| 10s \|/);
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

describe("generateComparison", () => {
  const base: EvalRunSummary = {
    schemaVersion: 1,
    spec: {
      schemaVersion: 1,
      backend: "claude",
      model: "sonnet",
      modelKey: "medium",
      rev: "oldrev",
      conditions: ["no-docs", "saaga-docs"],
      reps: 2,
      taskIds: ["neutral/a", "defect/b"],
      startedAt: "2026-08-23T08:00:00.000Z",
    },
    results: (["no-docs", "saaga-docs"] as const).flatMap((condition) =>
      [1, 2].flatMap((rep) => [
        {
          taskId: "neutral/a",
          half: "neutral" as const,
          condition,
          rep,
          exitCode: 0,
          pass: condition === "saaga-docs",
          metrics: { elapsedMs: 20_000, turns: 8, cacheReadTokens: 100_000, outputTokens: 1500, docsReads: condition === "saaga-docs" ? 3 : 0 },
          logFile: "x",
        },
        {
          taskId: "defect/b",
          half: "defect" as const,
          condition,
          rep,
          exitCode: 0,
          pass: true,
          metrics: { elapsedMs: 20_000, turns: 8, cacheReadTokens: 100_000, outputTokens: 1500, docsReads: condition === "saaga-docs" ? 1 : 0 },
          logFile: "x",
        },
      ]),
    ),
    finishedAt: "2026-08-23T09:00:00.000Z",
  };

  test("reports success deltas, task flips, and cost deltas", () => {
    const candidate = structuredClone(base);
    candidate.spec.rev = "newrev";
    for (const r of candidate.results) {
      r.pass = true; // the candidate corpus fixes neutral/a in the no-docs arm
      if (typeof r.metrics.cacheReadTokens === "number") {
        r.metrics.cacheReadTokens = 50_000; // and halves context
      }
    }

    const report = generateComparison(base, candidate);
    expect(report).toContain("| neutral | no-docs | 0/2 | 2/2 | +2 |");
    expect(report).toContain("| neutral | saaga-docs | 2/2 | 2/2 | 0 |");
    expect(report).toContain("| neutral/a | no-docs | 0/2 | 2/2 |");
    expect(report).not.toContain("| defect/b | no-docs |");
    expect(report).toContain("100000 → 50000 (-50%)");
  });

  test("identical runs report no task-level changes", () => {
    const report = generateComparison(base, structuredClone(base));
    expect(report).toContain("No task changed its pass rate");
  });

  test("refuses to compare different task sets", () => {
    const candidate = structuredClone(base);
    candidate.spec.taskIds = ["neutral/a"];
    expect(() => generateComparison(base, candidate)).toThrow(/task sets differ/);
  });

  test("refuses to compare different task-set versions", () => {
    const candidate = structuredClone(base);
    candidate.spec.taskSetVersion = 2;
    expect(() => generateComparison(base, candidate)).toThrow(/task-set versions differ/);
  });

  test("warns when the model differs between runs", () => {
    const candidate = structuredClone(base);
    candidate.spec.model = "haiku";
    candidate.spec.modelKey = "low";
    expect(generateComparison(base, candidate)).toContain("backend/model differ");
  });
});
