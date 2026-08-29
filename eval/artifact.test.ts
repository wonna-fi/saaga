import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { evalArgv } from "./src/argv.js";
import { renderArtifact, runLabel, toArtifactData } from "./src/artifact-gen.js";
import type { EvalRunSummary, TaskResult } from "./src/types.js";

const templatePath = fileURLToPath(new URL("./artifact/template.html", import.meta.url));

function result(over: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: "neutral/term-scope",
    half: "neutral",
    condition: "saaga-docs",
    rep: 1,
    exitCode: 0,
    pass: true,
    logFile: "logs/x.ndjson",
    metrics: { elapsedMs: 1000, turns: 4, cacheReadTokens: 900, docsReads: 2 },
    ...over,
  };
}

function summary(over: Partial<EvalRunSummary["spec"]> = {}, results = [result()]): EvalRunSummary {
  return {
    schemaVersion: 1,
    spec: {
      schemaVersion: 1,
      backend: "claude",
      model: "sonnet",
      modelKey: "medium",
      rev: "abc123def4567",
      conditions: ["no-docs", "saaga-docs"],
      reps: 2,
      taskIds: ["neutral/term-scope"],
      taskSetVersion: 2,
      startedAt: "2026-08-23T08:00:04.000Z",
      ...over,
    },
    results,
  };
}

function embedded(html: string): { runs: unknown[] } {
  const open = '<script id="eval-data" type="application/json">';
  const start = html.indexOf(open) + open.length;
  const end = html.indexOf("</script>", start);
  return JSON.parse(html.slice(start, end)) as { runs: unknown[] };
}

describe("evalArgv", () => {
  test("drops the separator pnpm forwards so flags are not lost", () => {
    expect(evalArgv(["--", "--reps", "8"])).toEqual(["--reps", "8"]);
  });

  test("leaves a plain flag list alone", () => {
    expect(evalArgv(["--reps", "8"])).toEqual(["--reps", "8"]);
  });
});

describe("artifact data", () => {
  test("orders runs oldest first so compare defaults to old -> new", () => {
    const data = toArtifactData([
      summary({ startedAt: "2026-08-29T14:09:26.000Z" }),
      summary({ startedAt: "2026-08-23T08:00:04.000Z" }),
    ]);
    expect(data.runs.map((r) => r.startedAt)).toEqual([
      "2026-08-23T08:00:04.000Z",
      "2026-08-29T14:09:26.000Z",
    ]);
  });

  test("gives runs distinct ids and a label carrying tier and arms", () => {
    const a = summary({ startedAt: "2026-08-23T08:00:04.000Z" });
    const b = summary({ startedAt: "2026-08-29T14:13:13.000Z", modelKey: "low" });
    const data = toArtifactData([a, b]);
    expect(new Set(data.runs.map((r) => r.id)).size).toBe(2);
    expect(runLabel(a)).toBe("2026-08-23 08:00Z · claude/medium · no-docs+saaga-docs · v2");
  });

  test("flattens metrics and resolves task kind from the registry map", () => {
    const data = toArtifactData([summary()], new Map([["neutral/term-scope", "code"]]));
    expect(data.runs[0].results[0]).toMatchObject({
      taskId: "neutral/term-scope",
      kind: "code",
      elapsedMs: 1000,
      turns: 4,
      cacheReadTokens: 900,
      docsReads: 2,
    });
  });

  test("keeps failure detail so the matrix can explain a red cell", () => {
    const data = toArtifactData([
      summary({}, [result({ pass: false, exitCode: 143, checkDetail: "Tests 7 failed" })]),
    ]);
    expect(data.runs[0].results[0]).toMatchObject({
      pass: false,
      exitCode: 143,
      checkDetail: "Tests 7 failed",
    });
  });
});

describe("artifact rendering", () => {
  test("injects data the page can parse back", async () => {
    const template = await readFile(templatePath, "utf8");
    const html = renderArtifact(template, toArtifactData([summary()]));
    expect(embedded(html).runs).toHaveLength(1);
  });

  test("escapes a closing script tag inside data instead of breaking the island", async () => {
    const template = await readFile(templatePath, "utf8");
    const html = renderArtifact(
      template,
      toArtifactData([summary({}, [result({ checkDetail: "</script><script>x" })])]),
    );
    const runs = embedded(html).runs as { results: { checkDetail: string }[] }[];
    expect(runs[0].results[0].checkDetail).toBe("</script><script>x");
  });

  test("refuses a template with no data island", () => {
    expect(() => renderArtifact("<p>no island</p>", toArtifactData([summary()]))).toThrow(
      /data island/,
    );
  });
});
