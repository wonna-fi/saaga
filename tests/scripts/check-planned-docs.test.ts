import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

import { NonResumableError } from "../../src/engine/errors.js";
import { checkPlannedDocs } from "../../src/scripts/check-planned-docs.js";

const DOCS_DIR = "saaga-docs";

const PHASES = `---
phases:
  - number: 0
    title: "Setup"
  - number: 1
    title: "Core"
---
`;

/** The two decision lines every planned document carries. */
function docLines(path: string): string {
  return (
    `- ${path} — Core, 100 lines\n` + `- ${path} — owns: thing; references: none\n`
  );
}

function planFor(paths: string[]): string {
  return `${PHASES}\n## Phase 1\n\n${paths.map(docLines).join("")}`;
}

/** An app with a plan on disk and, optionally, documents already written. */
async function tmpEnv(plan: string, written: string[] = []) {
  const app = await mkdtemp(join(tmpdir(), "saaga-planned-"));
  const planPath = join(app, "plan.md");
  await writeFile(planPath, plan, "utf8");

  for (const rel of written) {
    const full = join(app, DOCS_DIR, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, `# ${rel}\n`, "utf8");
  }

  return { app, plan: planPath };
}

function args(env: { app: string; plan: string }) {
  return { app_dir: env.app, docs_dir: DOCS_DIR, plan: env.plan };
}

describe("check-planned-docs", () => {
  test.each(["app_dir", "docs_dir", "plan"])(
    "'%s' is required",
    async (missing) => {
      const env = await tmpEnv(planFor([]), ["ARCHITECTURE.md"]);
      const full = { ...args(env), [missing]: "" };

      await expect(checkPlannedDocs(full, { cwd: env.app })).rejects.toThrow(
        `check-planned-docs: '${missing}' arg is required`,
      );
    },
  );

  // A missing plan means the flow is miswired, not that the corpus is
  // incomplete, so it is a plain Error and a resume hint still makes sense.
  test("an unreadable plan is a plain Error, not a NonResumableError", async () => {
    const env = await tmpEnv(planFor([]));
    const bad = { ...args(env), plan: join(env.app, "nope.md") };

    await expect(checkPlannedDocs(bad, { cwd: env.app })).rejects.toThrow(
      /cannot read the plan at/,
    );
    await expect(checkPlannedDocs(bad, { cwd: env.app })).rejects.not.toBeInstanceOf(
      NonResumableError,
    );
  });

  test("passes when every planned document, its index and ARCHITECTURE.md are on disk", async () => {
    const planned = ["concepts/alpha.md", "features/login.md"];
    const env = await tmpEnv(planFor(planned), [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "features/INDEX.md",
      ...planned,
    ]);

    // Nothing is filed under patterns/, so it owes no index.
    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 5,
      missing: 0,
    });
  });

  /**
   * Phase 0 writes the category indexes and no later step generates one, so a
   * phase 0 that reported success and wrote nothing leaves navigation with no
   * rows to build README.md and GLOSSARY.md from.
   */
  test("a category with planned documents needs its INDEX.md", async () => {
    const env = await tmpEnv(planFor(["concepts/alpha.md", "features/login.md"]), [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "concepts/alpha.md",
      "features/login.md",
    ]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err.message).toContain("1 of 5 documents");
    expect(err.message).toContain(`${DOCS_DIR}/features/INDEX.md`);
    expect(err.message).not.toContain("concepts/INDEX.md");
  });

  /**
   * ARCHITECTURE.md is written before the plan exists, so a plan that records
   * no decisions for it still owes the file. This is the #73 run's own shape:
   * the architecture step reported success and wrote nothing.
   */
  test("requires ARCHITECTURE.md even when the plan never names it", async () => {
    const env = await tmpEnv(planFor(["concepts/alpha.md"]), [
      "concepts/INDEX.md",
      "concepts/alpha.md",
    ]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err.message).toContain(`${DOCS_DIR}/ARCHITECTURE.md`);
    expect(err.message).toContain("1 of 3 documents");
  });

  test("names every missing document and none of the present ones", async () => {
    const planned = ["concepts/alpha.md", "concepts/beta.md", "features/login.md"];
    const env = await tmpEnv(planFor(planned), [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "features/INDEX.md",
      "concepts/alpha.md",
    ]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err.message).toContain("2 of 6 documents");
    expect(err.message).toContain(`${DOCS_DIR}/concepts/beta.md`);
    expect(err.message).toContain(`${DOCS_DIR}/features/login.md`);
    expect(err.message).not.toContain("concepts/alpha.md");
  });

  // The step reads the plan and the disk afresh on every attempt, so a corpus
  // completed by hand passes on resume. Suppressing the resume hint would
  // leave a full re-init, every slice included, as the only way out.
  test("a missing document is a plain Error with both ways out", async () => {
    const env = await tmpEnv(planFor(["concepts/alpha.md"]), ["ARCHITECTURE.md"]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err).not.toBeInstanceOf(NonResumableError);
    expect(err.message).toContain(`remove them from the plan at ${env.plan}, and then resume`);
    expect(err.message).toContain(`delete ${DOCS_DIR}/`);
  });

  // The roster parser charges budget for any line that leads with a `.md`
  // path, so a slice's "Key files to analyze" can put source files on it.
  // They are not documents this run writes.
  test("markdown source files a slice names are not required", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      docLines("concepts/alpha.md") +
      "- **Key files to analyze**:\n" +
      "  - `CONTRIBUTING.md` — the release checklist the flow follows\n" +
      "  - docs/decisions.md — the decision ledger\n" +
      "  `.claude/skills/x/SKILL.md`, `package.json`\n";
    const env = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "concepts/alpha.md",
    ]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 3,
      missing: 0,
    });
  });

  // A bare basename two categories share stays on the roster uncollapsed; it
  // names no folder, so there is no one path to require.
  test("a basename two categories share is not required on its own", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      docLines("concepts/payments.md") +
      docLines("features/payments.md") +
      "- `payments.md` is Core: everything else links to it\n";
    const env = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "features/INDEX.md",
      "concepts/payments.md",
      "features/payments.md",
    ]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 5,
      missing: 0,
    });
  });

  // `normalizeDocPath` keeps `..` segments, so a category prefix alone would
  // let a planned path resolve to a file outside the docs directory that the
  // run never wrote. Whether or not one is there, the path is not checked.
  test.each([true, false])(
    "a path that climbs out of the docs directory is not required (file outside: %s)",
    async (fileOutside) => {
      const plan =
        `${PHASES}\n## Phase 1\n\n` +
        docLines("concepts/alpha.md") +
        docLines("concepts/../../CONTRIBUTING.md");
      const env = await tmpEnv(plan, [
        "ARCHITECTURE.md",
        "concepts/INDEX.md",
        "concepts/alpha.md",
      ]);
      if (fileOutside) {
        await writeFile(join(env.app, "CONTRIBUTING.md"), "# Contributing\n", "utf8");
      }

      expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
        expected: 3,
        missing: 0,
      });
    },
  );

  // The budget gate refuses an unreadable plan only when it measured some
  // source, so this step has to refuse one too rather than check
  // ARCHITECTURE.md alone.
  test("a plan with domain phases but no readable documents fails", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      "| Document | Tier |\n|---|---|\n| concepts/alpha.md | Core |\n";
    const env = await tmpEnv(plan, ["ARCHITECTURE.md"]);

    await expect(checkPlannedDocs(args(env), { cwd: env.app })).rejects.toThrow(
      /declares domain phases but names no documents/,
    );
  });

  test("a plan with no domain phases requires ARCHITECTURE.md alone", async () => {
    const plan = `---\nphases:\n  - number: 0\n    title: "Setup"\n---\n`;
    const env = await tmpEnv(plan, ["ARCHITECTURE.md"]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 1,
      missing: 0,
    });
  });

  test("a directory at a document's path does not count as the document", async () => {
    const env = await tmpEnv(planFor(["concepts/alpha.md"]), ["ARCHITECTURE.md"]);
    await mkdir(join(env.app, DOCS_DIR, "concepts", "alpha.md"), {
      recursive: true,
    });

    await expect(checkPlannedDocs(args(env), { cwd: env.app })).rejects.toThrow(
      /concepts\/alpha\.md/,
    );
  });

  /**
   * Conventions are listed as a bare `{docs_dir}`-prefixed path with neither
   * decision line, and the navigation files are never rostered — so a
   * convention is required, an INDEX.md only as its category's index, and
   * README.md and GLOSSARY.md not at all.
   */
  test("conventions are required; README/GLOSSARY are not", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      docLines("concepts/alpha.md") +
      `- {docs_dir}/conventions/naming.md\n` +
      `- ${DOCS_DIR}/concepts/INDEX.md\n` +
      `- ${DOCS_DIR}/README.md\n` +
      `- ${DOCS_DIR}/GLOSSARY.md\n`;

    const complete = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "conventions/INDEX.md",
      "concepts/alpha.md",
      "conventions/naming.md",
    ]);
    expect(await checkPlannedDocs(args(complete), { cwd: complete.app })).toEqual({
      expected: 5,
      missing: 0,
    });

    const noConvention = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "concepts/alpha.md",
    ]);
    await expect(
      checkPlannedDocs(args(noConvention), { cwd: noConvention.app }),
    ).rejects.toThrow(/conventions\/naming\.md/);
  });

  // The plan carries worked examples inside fences; the roster parser strips
  // them, and this gate inherits that rather than demanding example files.
  test("paths inside fenced blocks are not required", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      docLines("concepts/alpha.md") +
      "```\n" +
      docLines("concepts/example.md") +
      "```\n";
    const env = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/INDEX.md",
      "concepts/alpha.md",
    ]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 3,
      missing: 0,
    });
  });

  // The message is the only report this gate writes, but a 60-document corpus
  // should not bury the recovery instruction under a wall of paths.
  test("a long missing list is capped and summarised", async () => {
    const planned = Array.from({ length: 25 }, (_, i) => `concepts/d${i}.md`);
    const env = await tmpEnv(planFor(planned), ["ARCHITECTURE.md", "concepts/INDEX.md"]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err.message).toContain("25 of 27 documents");
    expect(err.message).toContain("and 5 more");
    expect(err.message).toContain(`delete ${DOCS_DIR}/`);
  });
});
