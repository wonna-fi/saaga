import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  CONVENTION_MAX_BODY_LINES,
} from "../../src/docs/validate.js";
import {
  checkPlanBudget,
  countNonZeroPhases,
  deriveCeilings,
  docCost,
  isSourceFile,
  measureSource,
  MIN_DOC_CEILING,
  MIN_LINE_CEILING,
  normalizeDocPath,
  parsePlannedDocs,
  UNBUDGETED_CHARGE,
} from "../../src/docs/corpus-budget.js";

async function tmpApp(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "saaga-budget-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return dir;
}

const lines = (n: number) => `${"x\n".repeat(n)}`;

describe("what counts as source", () => {
  test("code extensions count, prose and config do not", () => {
    expect(isSourceFile("src/cli.ts")).toBe(true);
    expect(isSourceFile("src/app.py")).toBe(true);
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("package.json")).toBe(false);
  });

  // A lock file or CI matrix would raise the ceiling far more than it adds
  // documentable domain.
  test("yaml is not source", () => {
    expect(isSourceFile("pnpm-lock.yaml")).toBe(false);
    expect(isSourceFile("flows/init.flow.yaml")).toBe(false);
  });

  test("tests are excluded by directory and by filename", () => {
    expect(isSourceFile("tests/cli/init.test.ts")).toBe(false);
    expect(isSourceFile("test/helper.ts")).toBe(false);
    expect(isSourceFile("src/__tests__/thing.ts")).toBe(false);
    expect(isSourceFile("src/thing.spec.ts")).toBe(false);
    expect(isSourceFile("src/thing.ts")).toBe(true);
  });

  // Test naming is language convention, not one rule; missing a language's
  // form lets its test volume buy a bigger corpus.
  test("language-standard test names are excluded too", () => {
    expect(isSourceFile("pkg/server_test.go")).toBe(false);
    expect(isSourceFile("src/lib_test.rs")).toBe(false);
    expect(isSourceFile("app/test_models.py")).toBe(false);
    expect(isSourceFile("src/OrderServiceTest.java")).toBe(false);
    expect(isSourceFile("src/OrderTests.cs")).toBe(false);
  });

  // The allowlist silently disables the whole feature for a language it omits,
  // so the mainstream ones have to be present.
  test("mainstream compiled and mobile languages count as source", () => {
    for (const p of ["a.c", "a.h", "a.cpp", "a.hpp", "a.dart", "a.swift", "a.kt", "a.ex"]) {
      expect(isSourceFile(`src/${p}`), p).toBe(true);
    }
  });

  // "latest.ts" ends in "test" only as a substring of the stem.
  test("a filename merely containing 'test' is still source", () => {
    expect(isSourceFile("src/latest.ts")).toBe(true);
    expect(isSourceFile("src/contest.ts")).toBe(true);
  });
});

describe("measuring a repository", () => {
  test("counts source lines and ignores everything else", async () => {
    const app = await tmpApp({
      "src/a.ts": lines(100),
      "src/b.ts": lines(50),
      "README.md": lines(400),
      "package.json": lines(30),
    });

    expect(await measureSource(app, "saaga-docs")).toEqual({ files: 2, lines: 150 });
  });

  test("ignored trees do not raise the ceiling", async () => {
    const app = await tmpApp({
      "src/a.ts": lines(100),
      "vendor/big.ts": lines(9000),
      ".saagaignore": "vendor/\n",
    });

    expect((await measureSource(app, "saaga-docs")).lines).toBe(100);
  });

  test("tests do not raise the ceiling", async () => {
    const app = await tmpApp({
      "src/a.ts": lines(100),
      "tests/a.test.ts": lines(5000),
    });

    expect((await measureSource(app, "saaga-docs")).lines).toBe(100);
  });

  test("the docs directory is not source", async () => {
    const app = await tmpApp({
      "src/a.ts": lines(100),
      "saaga-docs/concepts/x.ts": lines(500),
    });

    expect((await measureSource(app, "saaga-docs")).lines).toBe(100);
  });

  test("a file without a trailing newline still counts its last line", async () => {
    const app = await tmpApp({ "src/a.ts": "one\ntwo" });
    expect((await measureSource(app, "saaga-docs")).lines).toBe(2);
  });

  // The manifest hashes a link's target string rather than following it.
  // Following one here could count an ignored file, count an in-repo file
  // twice, or pull an external file into the ceiling.
  test("symlinks are not followed", async () => {
    const app = await tmpApp({ "src/a.ts": lines(100) });
    await writeFile(join(app, "big.txt"), lines(9000), "utf8");
    await symlink(join(app, "big.txt"), join(app, "src", "link.ts"));

    expect(await measureSource(app, "saaga-docs")).toEqual({ files: 1, lines: 100 });
  });
});

describe("deriving the ceilings", () => {
  test("scales with source size", () => {
    expect(deriveCeilings({ files: 100, lines: 13600 })).toEqual({ docs: 32, lines: 3400 });
  });

  // A 1,000-line app would otherwise be allowed two documents.
  test("floors keep a small project usable", () => {
    const ceilings = deriveCeilings({ files: 3, lines: 1000 });
    expect(ceilings.docs).toBe(MIN_DOC_CEILING);
    expect(ceilings.lines).toBe(MIN_LINE_CEILING);
  });

  test("no source means no ceiling to derive", () => {
    expect(deriveCeilings({ files: 0, lines: 0 })).toEqual({ docs: 0, lines: 0 });
  });
});

describe("normalizing the paths a plan writes", () => {
  test("strips the docs dir and its placeholders", () => {
    expect(normalizeDocPath("saaga-docs/concepts/a.md", "saaga-docs")).toBe("concepts/a.md");
    expect(normalizeDocPath("{docs_dir}/conventions/naming.md", "saaga-docs")).toBe(
      "conventions/naming.md",
    );
    expect(normalizeDocPath("./concepts/a.md", "saaga-docs")).toBe("concepts/a.md");
  });

  test("rejects anything that is not a markdown path", () => {
    expect(normalizeDocPath("src/cli.ts", "saaga-docs")).toBeNull();
  });
});

describe("reading the documents a plan authors", () => {
  const PLAN = `---
phases:
  - number: 0
    title: "Setup"
  - number: 1
    title: "Core"
---

## Phase 1

- \`saaga-docs/concepts/scope.md\` — Core, 150 lines
- saaga-docs/patterns/adding-scripts.md — Supporting, 80 lines
- ARCHITECTURE.md — 250 lines
- saaga-docs/concepts/scope.md — owns: the scope model; references: saaga-docs/features/init.md
- saaga-docs/patterns/adding-scripts.md — owns: the script contract; references: saaga-docs/concepts/scope.md

## Phase 2: Conventions

- {docs_dir}/conventions/naming.md
`;

  test("counts budgets, ARCHITECTURE and conventions; ignores referenced paths", () => {
    const parse = parsePlannedDocs(PLAN, "saaga-docs");
    expect(parse.docs.map((d) => d.path)).toEqual([
      "ARCHITECTURE.md",
      "concepts/scope.md",
      "conventions/naming.md",
      "patterns/adding-scripts.md",
    ]);

    // features/init.md appears only on a references: right-hand side.
    expect(parse.docs.map((d) => d.path)).not.toContain("features/init.md");
  });

  test("a convention costs the fixed cap, not a budget", () => {
    const parse = parsePlannedDocs(PLAN, "saaga-docs");
    const convention = parse.docs.find((d) => d.path === "conventions/naming.md")!;

    expect(convention.isConvention).toBe(true);
    expect(convention.budget).toBeNull();
    expect(docCost(convention)).toBe(CONVENTION_MAX_BODY_LINES);
  });

  test("ARCHITECTURE's tier-less budget line is read", () => {
    const parse = parsePlannedDocs(PLAN, "saaga-docs");
    expect(parse.docs.find((d) => d.path === "ARCHITECTURE.md")!.budget).toBe(250);
  });

  // Otherwise the tier floor is escapable from the other side: a domain
  // document with no tier has no floor to be held to.
  test("a tier-less budget is honoured only for ARCHITECTURE", () => {
    const parse = parsePlannedDocs(
      "- concepts/auth.md — 1 line\n- concepts/auth.md — owns: auth; references: none\n",
      "saaga-docs",
    );

    const doc = parse.docs.find((d) => d.path === "concepts/auth.md")!;
    expect(doc.budget).toBeNull();
    expect(docCost(doc)).toBe(UNBUDGETED_CHARGE);
  });

  test("generated documents are excluded", () => {
    const parse = parsePlannedDocs(
      "- saaga-docs/concepts/INDEX.md — Core, 100 lines\n" +
        "- saaga-docs/GLOSSARY.md — Core, 100 lines\n" +
        "- saaga-docs/concepts/a.md — Core, 100 lines\n" +
        "- saaga-docs/concepts/a.md — owns: a; references: none\n",
      "saaga-docs",
    );
    expect(parse.docs.map((d) => d.path)).toEqual(["concepts/a.md"]);
  });

  test("tolerates the separators and decoration a model actually writes", () => {
    for (const dash of ["—", "–", "--", "-"]) {
      const parse = parsePlannedDocs(`* **concepts/a.md** ${dash} core, 90 lines\n`, "saaga-docs");
      expect(parse.docs[0]?.budget, `separator ${dash}`).toBe(90);
    }
  });

  // The worked example in the LOD policy is a bare basename, so a plan mixing
  // forms for one document must not count it twice.
  test("a bare basename collapses onto its qualified document", () => {
    const parse = parsePlannedDocs(
      "- scope.md — Core, 150 lines\n- saaga-docs/concepts/scope.md — owns: x; references: none\n",
      "saaga-docs",
    );

    expect(parse.docs).toHaveLength(1);
    expect(parse.docs[0].path).toBe("concepts/scope.md");
    expect(parse.docs[0].budget).toBe(150);
    expect(parse.ambiguous).toEqual([]);
  });

  // Tier travels with the budget it qualifies; carrying the number alone would
  // make the mixed path forms a way around the tier floor.
  test("collapsing a basename carries its tier, not just its number", () => {
    const parse = parsePlannedDocs(
      "- scope.md — Core, 1 line\n- concepts/scope.md — owns: x; references: none\n",
      "saaga-docs",
    );

    expect(parse.docs).toHaveLength(1);
    expect(parse.docs[0].tier).toBe("core");
    expect(docCost(parse.docs[0])).toBe(100);
  });

  // slice-doc creates every file a phase lists, so a deliverable with no
  // decision lines is a document the corpus pays for and the ceiling never saw.
  test("a deliverable with no decision lines is still on the roster", () => {
    const parse = parsePlannedDocs(
      "- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: a; references: none\n" +
        "- `saaga-docs/features/orphan.md`\n",
      "saaga-docs",
    );

    expect(parse.docs.map((d) => d.path)).toEqual(["concepts/a.md", "features/orphan.md"]);
    expect(parse.docs.find((d) => d.path === "features/orphan.md")!.budget).toBeNull();
  });

  // The plan format does not forbid a description after the path, and a
  // deliverable missed here is a file slice-doc creates for free.
  test("a deliverable with a description after the path still counts", () => {
    const parse = parsePlannedDocs(
      "- features/login.md — User authentication\n" +
        "- `patterns/retry.md`: how retries are wired\n",
      "saaga-docs",
    );

    expect(parse.docs.map((d) => d.path)).toEqual(["features/login.md", "patterns/retry.md"]);
  });

  // Leading with the path is what separates announcing a file from citing one.
  test("a path cited mid-sentence is a mention, not a deliverable", () => {
    const parse = parsePlannedDocs(
      "- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: a; references: none\n" +
        "- Notes: see features/login.md for the flow this builds on.\n" +
        "The rule already lives in conventions/naming.md today.\n",
      "saaga-docs",
    );

    expect(parse.docs.map((d) => d.path)).toEqual(["concepts/a.md"]);
  });

  test("an ambiguous basename is reported rather than guessed", () => {
    const parse = parsePlannedDocs(
      "- a.md — Core, 150 lines\n" +
        "- concepts/a.md — owns: x; references: none\n" +
        "- patterns/a.md — owns: y; references: none\n",
      "saaga-docs",
    );
    expect(parse.ambiguous).toEqual(["a.md"]);
  });

  test("document lines inside a fence are illustration, not decisions", () => {
    const parse = parsePlannedDocs(
      "```yaml\n- concepts/fake.md — Core, 900 lines\n```\n" +
        "- concepts/real.md — Core, 100 lines\n" +
        "- concepts/real.md — owns: x; references: none\n",
      "saaga-docs",
    );
    expect(parse.docs.map((d) => d.path)).toEqual(["concepts/real.md"]);
  });

  test("a document budgeted in two phases is still one document", () => {
    const parse = parsePlannedDocs(
      "- concepts/a.md — Core, 100 lines\n- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: x; references: none\n",
      "saaga-docs",
    );
    expect(parse.docs).toHaveLength(1);
  });

  // A convention named in a references list or in prose is being referred to,
  // not created; counting it costs three re-plans over a document the plan
  // never makes.
  test("a convention only mentioned is not a convention planned", () => {
    const parse = parsePlannedDocs(
      "- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: a; references: saaga-docs/conventions/naming.md\n" +
        "The naming rule already lives in saaga-docs/conventions/naming.md today.\n",
      "saaga-docs",
    );

    expect(parse.docs.map((d) => d.path)).toEqual(["concepts/a.md"]);
  });

  test("a convention listed as its own deliverable line is planned", () => {
    const parse = parsePlannedDocs("- `saaga-docs/conventions/naming.md`\n", "saaga-docs");
    expect(parse.docs.map((d) => d.path)).toEqual(["conventions/naming.md"]);
  });

  test("counts the phases that author documents", () => {
    expect(countNonZeroPhases(PLAN)).toBe(1);
    expect(countNonZeroPhases("# no frontmatter")).toBe(0);
  });

  // parse-plan accepts CRLF frontmatter. If this did not, a CRLF plan would
  // report zero phases, skipping the empty-roster guard and passing as a
  // zero-document corpus.
  test("CRLF plans are read the same as LF plans", () => {
    const crlf = PLAN.replace(/\n/g, "\r\n");

    expect(countNonZeroPhases(crlf)).toBe(1);
    expect(parsePlannedDocs(crlf, "saaga-docs").docs.map((d) => d.path)).toEqual(
      parsePlannedDocs(PLAN, "saaga-docs").docs.map((d) => d.path),
    );
  });
});

describe("the verdict", () => {
  const ceilings = { docs: 10, lines: 1000 };
  const source = { files: 20, lines: 4000 };
  const parsed = (text: string) => parsePlannedDocs(text, "saaga-docs");

  /**
   * ARCHITECTURE.md is on disk whatever the plan says, so a complete plan
   * records its decisions and the fixtures do too — otherwise every expected
   * total carries a hidden seeded document.
   */
  const ARCH = "- ARCHITECTURE.md — 250 lines\n- ARCHITECTURE.md — owns: shape; references: none\n";

  /** `tier` matters: a budget below its band is charged the band's floor. */
  function budgetedDocs(n: number, linesEach: number, tier = "Core"): string {
    return (
      ARCH +
      Array.from({ length: n }, (_, i) =>
        `- concepts/d${i}.md — ${tier}, ${linesEach} lines\n- concepts/d${i}.md — owns: x; references: none\n`,
      ).join("")
    );
  }

  test("a plan inside both ceilings passes", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(5, 100)), ceilings, source, 1);
    expect(report.status).toBe("PASS");
    expect(report.docs).toBe(6); // 5 domain documents + ARCHITECTURE.md
    expect(report.lines).toBe(750);
  });

  test("too many documents fails even when the lines fit", () => {
    // 20 Peripheral documents at their band's floor: 500 lines, well inside
    // the 1000 ceiling, so only the count can fail this.
    const report = checkPlanBudget(parsed(budgetedDocs(20, 25, "Peripheral")), ceilings, source, 1);
    expect(report.status).toBe("OVER");
    expect(report.reasons).toContain("over-doc-count");
    expect(report.reasons).not.toContain("over-line-budget");
  });

  // Otherwise the line ceiling is met by shrinking numbers rather than cutting
  // documents — the one response the policy rules out.
  test("a budget below its declared tier is charged the tier's floor", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(5, 1)), ceilings, source, 1);

    expect(report.lines).toBe(750); // 5 x the Core floor of 100, + ARCHITECTURE
    expect(report.reasons).toContain("below-tier");
    expect(report.belowTier).toHaveLength(5);
  });

  test("a budget inside its band is charged as written", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(5, 140)), ceilings, source, 1);

    expect(report.lines).toBe(950);
    expect(report.reasons).not.toContain("below-tier");
  });

  test("too many lines fails even when the count fits", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(5, 400)), ceilings, source, 1);
    expect(report.status).toBe("OVER");
    expect(report.reasons).toContain("over-line-budget");
  });

  // Charging zero would make an unbudgeted document the cheapest way to evade
  // the ceiling.
  test("an unbudgeted document is charged the Core band, not nothing", () => {
    const report = checkPlanBudget(
      parsed(
        ARCH +
          "- concepts/a.md — owns: x; references: none\n" +
          "- concepts/b.md — Core, 120 lines\n" +
          "- concepts/b.md — owns: y; references: none\n",
      ),
      ceilings,
      source,
      1,
    );
    expect(report.unbudgeted).toEqual(["concepts/a.md"]);
    expect(report.lines).toBe(UNBUDGETED_CHARGE + 120 + 250);
    expect(report.reasons).toContain("unbudgeted");
  });

  // The plan may state its own totals; they are informational.
  test("ceilings the plan declares for itself are ignored", () => {
    const text =
      "Total documents: 3 (ceiling 500). Total budgeted lines: 300 (ceiling 99999).\n" +
      budgetedDocs(20, 10);
    const report = checkPlanBudget(parsed(text), ceilings, source, 1);
    expect(report.status).toBe("OVER");
    expect(report.ceilings).toEqual(ceilings);
  });

  // document-architecture runs before the plan and always writes the file, so
  // a plan that omits its decisions would otherwise get ~250 lines free.
  test("ARCHITECTURE.md is charged even when the plan never mentions it", () => {
    const plan =
      "- concepts/a.md — Core, 100 lines\n- concepts/a.md — owns: a; references: none\n";
    const report = checkPlanBudget(parsed(plan), ceilings, source, 1);

    expect(report.docs).toBe(2);
    expect(report.lines).toBe(100 + UNBUDGETED_CHARGE);
    expect(report.unbudgeted).toContain("ARCHITECTURE.md");
  });

  test("a declared ARCHITECTURE.md is not counted twice", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(1, 100)), ceilings, source, 1);

    expect(report.docs).toBe(2);
    expect(report.lines).toBe(350);
  });

  // Reported so a planner can fix it, but never fatal: failing here would put
  // a path-normalisation miss between the user and their corpus.
  test("a document with no ownership line is reported, not failed", () => {
    const report = checkPlanBudget(
      parsed(ARCH + "- concepts/a.md — Core, 100 lines\n"),
      ceilings,
      source,
      1,
    );

    expect(report.status).toBe("PASS");
    expect(report.reasons).toContain("missing-ownership");
    expect(report.missingOwnership).toEqual(["concepts/a.md"]);
  });

  test("a repository with no measurable source passes", () => {
    const report = checkPlanBudget(parsed(budgetedDocs(50, 900)), { docs: 0, lines: 0 }, { files: 0, lines: 0 }, 1);
    expect(report.status).toBe("PASS");
    expect(report.reasons).toEqual(["no-measurable-source"]);
  });

  // Parser drift must never pass silently: an unreadable plan is an unchecked one.
  test("domain phases but no readable documents is unparseable", () => {
    const report = checkPlanBudget(parsed("# Plan body\n"), ceilings, source, 2);
    expect(report.status).toBe("UNPARSEABLE");
    expect(report.reasons).toEqual(["empty-roster"]);
  });

  test("a phase-0-only plan authors nothing and passes", () => {
    const report = checkPlanBudget(parsed("# Plan body\n"), ceilings, source, 0);
    expect(report.status).toBe("PASS");
  });

  test("budget lines without ownership lines is drift, not a pass", () => {
    const report = checkPlanBudget(parsed("- concepts/a.md — Core, 10 lines\n"), ceilings, source, 1);
    expect(report.status).toBe("UNPARSEABLE");
    expect(report.reasons).toEqual(["one-sided-roster"]);
  });
});
