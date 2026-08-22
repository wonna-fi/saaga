import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EVAL_TASKS, selectTasks, validateRegistry } from "./src/registry.js";

const tasksDir = fileURLToPath(new URL("tasks", import.meta.url));

describe("task registry", () => {
  test("holds a valid 10-20 task set with unique, half-prefixed ids", () => {
    expect(() => validateRegistry()).not.toThrow();
    expect(EVAL_TASKS.length).toBe(17);
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
    const files: string[] = [];
    for (const half of await readdir(tasksDir)) {
      for (const name of await readdir(join(tasksDir, half))) {
        files.push(join(tasksDir, half, name));
      }
    }
    expect(files.length).toBeGreaterThanOrEqual(EVAL_TASKS.length);

    // Tasks must not name the docs corpus, the routing files, or the
    // condition machinery: prompts and checks stay condition-blind.
    const forbidden = ["saaga-docs", "AGENTS.md", "CLAUDE.md", "ConditionId", "no-docs", "openwiki"];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const needle of forbidden) {
        expect(content, `${file} must not contain "${needle}"`).not.toContain(needle);
      }
    }
  });
});
