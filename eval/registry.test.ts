import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EVAL_TASKS, selectTasks, validateRegistry } from "./src/registry.js";

const tasksDir = fileURLToPath(new URL("tasks", import.meta.url));

describe("task registry", () => {
  test("holds a valid 10-25 task set with unique, half-prefixed ids", () => {
    expect(() => validateRegistry()).not.toThrow();
    expect(EVAL_TASKS.length).toBe(23);
  });

  test("code tasks are execution-graded and scoped out of docs-only", () => {
    const codeTasks = EVAL_TASKS.filter((t) => t.kind === "code");
    expect(codeTasks.length).toBe(6);
    for (const t of codeTasks) {
      expect(t.prepare, t.id).toBeDefined();
      expect(t.targetTests?.length, t.id).toBeGreaterThan(0);
      expect(t.targetFiles?.length, t.id).toBeGreaterThan(0);
      expect(t.appliesTo, t.id).toBeDefined();
      expect(t.appliesTo, t.id).not.toContain("docs-only");
    }
    // Answer tasks stay unrestricted: appliesTo is registry policy for code tasks only.
    for (const t of EVAL_TASKS.filter((t) => t.kind === "answer")) {
      expect(t.appliesTo, t.id).toBeUndefined();
    }
  });

  test("both halves are populated", () => {
    const defect = EVAL_TASKS.filter((t) => t.half === "defect");
    const neutral = EVAL_TASKS.filter((t) => t.half === "neutral");
    expect(defect.length).toBeGreaterThanOrEqual(5);
    expect(neutral.length).toBeGreaterThanOrEqual(5);
  });

  test("selectTasks expands prefixes and exact ids, keeps registry order", () => {
    const defect = selectTasks(["defect/*"]);
    expect(defect.map((t) => t.half)).toEqual(defect.map(() => "defect"));
    const one = selectTasks(["neutral/anchor-model-defaults"]);
    expect(one).toHaveLength(1);
    expect(selectTasks(undefined)).toHaveLength(EVAL_TASKS.length);
    expect(() => selectTasks(["nope/*"])).toThrow(/no tasks match/);
  });
});

describe("condition blindness", () => {
  test("no task module references a condition artifact", async () => {
    // Recursive: fixture stubs under tasks/*/fixtures/ are scanned too.
    async function collect(dir: string, out: string[]): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await collect(path, out);
        else out.push(path);
      }
    }
    const files: string[] = [];
    await collect(tasksDir, files);
    expect(files.length).toBeGreaterThanOrEqual(EVAL_TASKS.length);

    // Tasks must not name the docs corpus, the routing files, or the
    // condition machinery: prompts and checks stay condition-blind.
    const forbidden = ["saaga-docs", "AGENTS.md", "CLAUDE.md", "ConditionId", "no-docs", "docs-only", "openwiki"];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const needle of forbidden) {
        expect(content, `${file} must not contain "${needle}"`).not.toContain(needle);
      }
    }
  });
});
