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

  test("passes when every planned document and ARCHITECTURE.md are on disk", async () => {
    const planned = ["concepts/alpha.md", "features/login.md"];
    const env = await tmpEnv(planFor(planned), ["ARCHITECTURE.md", ...planned]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 3,
      missing: 0,
    });
  });

  /**
   * ARCHITECTURE.md is written before the plan exists, so a plan that records
   * no decisions for it still owes the file. This is the #73 run's own shape:
   * the architecture step reported success and wrote nothing.
   */
  test("requires ARCHITECTURE.md even when the plan never names it", async () => {
    const env = await tmpEnv(planFor([]));

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err).toBeInstanceOf(NonResumableError);
    expect(err.message).toContain(`${DOCS_DIR}/ARCHITECTURE.md`);
    expect(err.message).toContain("1 of 1 documents");
  });

  test("names every missing document and none of the present ones", async () => {
    const planned = ["concepts/alpha.md", "concepts/beta.md", "features/login.md"];
    const env = await tmpEnv(planFor(planned), [
      "ARCHITECTURE.md",
      "concepts/alpha.md",
    ]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err).toBeInstanceOf(NonResumableError);
    expect(err.message).toContain("2 of 4 documents");
    expect(err.message).toContain(`${DOCS_DIR}/concepts/beta.md`);
    expect(err.message).toContain(`${DOCS_DIR}/features/login.md`);
    expect(err.message).not.toContain("concepts/alpha.md");
    // Resuming replays the journal, so the recovery is a re-init.
    expect(err.message).toContain(`delete ${DOCS_DIR}/`);
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
   * decision line, and the generated navigation files are never rostered — so
   * a convention is required and an INDEX.md is not.
   */
  test("conventions are required; generated INDEX/README/GLOSSARY are not", async () => {
    const plan =
      `${PHASES}\n## Phase 1\n\n` +
      docLines("concepts/alpha.md") +
      `- {docs_dir}/conventions/naming.md\n` +
      `- ${DOCS_DIR}/concepts/INDEX.md\n` +
      `- ${DOCS_DIR}/README.md\n` +
      `- ${DOCS_DIR}/GLOSSARY.md\n`;

    const complete = await tmpEnv(plan, [
      "ARCHITECTURE.md",
      "concepts/alpha.md",
      "conventions/naming.md",
    ]);
    expect(await checkPlannedDocs(args(complete), { cwd: complete.app })).toEqual({
      expected: 3,
      missing: 0,
    });

    const noConvention = await tmpEnv(plan, ["ARCHITECTURE.md", "concepts/alpha.md"]);
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
    const env = await tmpEnv(plan, ["ARCHITECTURE.md", "concepts/alpha.md"]);

    expect(await checkPlannedDocs(args(env), { cwd: env.app })).toEqual({
      expected: 2,
      missing: 0,
    });
  });

  // The message is the only report this gate writes, but a 60-document corpus
  // should not bury the recovery instruction under a wall of paths.
  test("a long missing list is capped and summarised", async () => {
    const planned = Array.from({ length: 25 }, (_, i) => `concepts/d${i}.md`);
    const env = await tmpEnv(planFor(planned), ["ARCHITECTURE.md"]);

    const err = await checkPlannedDocs(args(env), { cwd: env.app }).catch((e) => e);
    expect(err.message).toContain("25 of 26 documents");
    expect(err.message).toContain("and 5 more");
    expect(err.message).toContain(`delete ${DOCS_DIR}/`);
  });
});
