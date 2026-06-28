import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parsePlan } from "../../src/scripts/parse-plan.js";

async function tmpPlan(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "saaga-plan-"));
  const path = join(dir, "plan.md");
  await writeFile(path, content, "utf8");
  return path;
}

const SAMPLE_PLAN = `---
app: salesforce
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Concepts and Data Model"
  - number: 2
    title: "Authentication and API Layer"
---

# Documentation Plan

Anything else here.
`;

describe("parse-plan script", () => {
  test("returns [{number, title}] for each phase in the YAML frontmatter", async () => {
    const path = await tmpPlan(SAMPLE_PLAN);
    const phases = await parsePlan({ file: path }, { cwd: "/x" });
    expect(phases).toEqual([
      { number: 0, title: "Setup Structure" },
      { number: 1, title: "Core Concepts and Data Model" },
      { number: 2, title: "Authentication and API Layer" },
    ]);
  });

  test("requires the 'file' arg", async () => {
    await expect(
      parsePlan({} as { file: string }, { cwd: "/x" }),
    ).rejects.toThrow(/file/);
  });

  test("throws when the file does not exist", async () => {
    await expect(
      parsePlan({ file: "/nonexistent/plan.md" }, { cwd: "/x" }),
    ).rejects.toThrow();
  });

  test("throws when there is no YAML frontmatter", async () => {
    const path = await tmpPlan("# no frontmatter here\n\nBody only.\n");
    await expect(parsePlan({ file: path }, { cwd: "/x" })).rejects.toThrow(
      /frontmatter/,
    );
  });

  test("throws when frontmatter has no phases array", async () => {
    const path = await tmpPlan(`---
app: x
---
# body
`);
    await expect(parsePlan({ file: path }, { cwd: "/x" })).rejects.toThrow(
      /phases/,
    );
  });

  test("allows an empty phases array by default (e.g. update no-op plans)", async () => {
    const path = await tmpPlan(`---
phases: []
---
# body
`);
    await expect(parsePlan({ file: path }, { cwd: "/x" })).resolves.toEqual([]);
  });

  test("throws on an empty phases array when require_phases is set", async () => {
    const path = await tmpPlan(`---
phases: []
---
# body
`);
    await expect(
      parsePlan({ file: path, require_phases: "true" }, { cwd: "/x" }),
    ).rejects.toThrow(/phases.*empty/);
  });

  test("treats numeric strings and integer numbers identically", async () => {
    const path = await tmpPlan(`---
phases:
  - number: "0"
    title: Setup
  - number: 1
    title: Core
---
`);
    const phases = await parsePlan({ file: path }, { cwd: "/x" });
    expect(phases).toEqual([
      { number: 0, title: "Setup" },
      { number: 1, title: "Core" },
    ]);
  });
});
