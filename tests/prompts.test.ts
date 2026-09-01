import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { PROMPTS_DIR } from "../src/paths.js";
import { renderPromptFile } from "../src/templates.js";

/**
 * Fixture tests over the real `prompts/` tree.
 *
 * These guard the split that task 0 introduced: the doc writer and verifier
 * must receive the methodology verbatim in their own prompt, and the planning
 * prompts must no longer instruct the model to re-emit it into the plan.
 */

/** The vars each flow actually passes to the step, so the render is realistic. */
const FLOW_VARS: Record<string, Record<string, string>> = {
  "slice-doc": {
    plan: "/run/plan.md",
    phase_number: "1",
    docs_dir: "saaga-docs",
  },
  "verify-domain-documentation": {
    plan: "/run/plan.md",
    phase_number: "1",
    review_path: "/run/slice-1/review-1.md",
    status_path: "/run/slice-1/status-1.txt",
    changes_dir: "none",
    docs_dir: "saaga-docs",
    date: "2026-08-29",
    iteration: "1",
    loop_max: "3",
    deferred_minors_path: "/run/slice-1/deferred-minors.md",
  },
  "fix-documentation": {
    plan: "/run/plan.md",
    phase_number: "1",
    review_path: "/run/slice-1/review-1.md",
    docs_dir: "saaga-docs",
  },
  "plan-init": {
    app: "saaga",
    docs_dir: "saaga-docs",
    output_path: "/run/plans/saaga-init.plan.md",
    budget_report_path: "/run/plan-budget-report.md",
  },
  "plan-update": {
    app: "saaga",
    docs_dir: "saaga-docs",
    changes_path: "/run/changes.md",
    output_path: "/run/plans/saaga-update.plan.md",
  },
  "plan-verify-quick-updates": {
    app: "saaga",
    docs_dir: "saaga-docs",
    manifest_path: "/run/manifest.json",
    metadata_dir: "/run/quick-updates",
    output_path: "/run/plans/saaga-vqu.plan.md",
  },
  "quick-update": {
    app: "saaga",
    docs_dir: "saaga-docs",
    changes_path: "/run/changes.md",
    status_path: "/run/quick-update-status.txt",
    summary_path: "/app/saaga-docs/metadata/quick_updates/r1/summary.md",
  },
  "verify-architecture": {
    plan: "/run/plans/saaga-init.plan.md",
    review_path: "/run/architecture/review-1.md",
    status_path: "/run/architecture/status-1.txt",
    docs_dir: "saaga-docs",
    date: "2026-08-30",
    iteration: "1",
    loop_max: "3",
    deferred_minors_path: "/run/architecture/deferred-minors.md",
  },
  "document-architecture": {
    app: "saaga",
    docs_dir: "saaga-docs",
    scratch_path: "/run/app-structure.md",
  },
};

function render(name: string): Promise<string> {
  return renderPromptFile(
    resolve(PROMPTS_DIR, `${name}.md`),
    FLOW_VARS[name] ?? {},
    { includeRoots: [PROMPTS_DIR] },
  );
}

const ALL_PROMPTS = Object.keys(FLOW_VARS);

describe("rendered prompts", () => {
  test.for(ALL_PROMPTS)("%s resolves every include", async (name) => {
    const out = await render(name);
    expect(out).not.toContain("{include:");
  });

  test.for(ALL_PROMPTS)("%s leaves no flow variable unsubstituted", async (name) => {
    const out = await render(name);
    // Literal template tokens like {Type} or {method} are intentional; the
    // flow-supplied vars are the ones that must all be filled.
    for (const key of Object.keys(FLOW_VARS[name])) {
      expect(out).not.toContain(`{${key}}`);
    }
  });
});

describe("methodology reaches the writer and verifier directly", () => {
  test("slice-doc carries the three document templates", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("### CONCEPT TEMPLATE");
    expect(out).toContain("### PATTERN TEMPLATE");
    expect(out).toContain("### FEATURE TEMPLATE");
  });

  test("slice-doc carries decision guidance and uncertainty handling", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("Is it a Concept, Pattern, Convention, or Feature?");
    expect(out).toContain("When Code Logic is Unclear");
  });

  test("slice-doc no longer defers to the plan for templates", async () => {
    const out = await render("slice-doc");
    expect(out).not.toContain("Follow the templates in the plan");
    expect(out).not.toContain("quality checklists defined in the plan");
  });

  test("verify carries the checklists, the protocol and the templates", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("### Concept Doc Checklist");
    expect(out).toContain("## Mandatory Verification Protocol");
    expect(out).toContain("### CONCEPT TEMPLATE");
  });

  test("fix carries the templates, decision guidance and checklists", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("### CONCEPT TEMPLATE");
    expect(out).toContain("Is it a Concept, Pattern, Convention, or Feature?");
    expect(out).toContain("### Pattern Doc Checklist");
  });

  test("verify no longer mines the plan for the checklists or protocol", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).not.toContain("The **Quality Checklists** (to know what to verify");
    expect(out).not.toContain("The **Mandatory Verification Protocol** (the step-by-step");
  });
});

/**
 * Task 1: the frontmatter rules have to reach every prompt that writes or
 * touches a document, not just the plan.
 */
describe("frontmatter instructions reach the prompts that write documents", () => {
  test("slice-doc carries the frontmatter schema", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("### DOCUMENT FRONTMATTER");
    expect(out).toContain("last_verified");
    expect(out).toContain("`type` follows the document's kind");
  });

  test("the doc templates themselves mandate frontmatter", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("type: concept");
    expect(out).toContain("type: pattern");
    expect(out).toContain("type: feature");
    expect(out).toContain("type: index");
  });

  test("fix-documentation carries the frontmatter schema", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("### DOCUMENT FRONTMATTER");
  });

  test("document-architecture asks for architecture-typed frontmatter", async () => {
    const out = await render("document-architecture");
    expect(out).toContain("type: architecture");
    expect(out).toContain("Do not write a `last_verified` field");
  });

  test("verify stamps the documents it found clean", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("## Step 7: Stamp `last_verified` per Document");
    expect(out).toContain("set `last_verified: 2026-08-29`");
    expect(out).toContain("No row of the findings table names it");
  });

  test("verify deletes the stamp from a document it recorded a finding against", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("A row names it in the Document column");
    expect(out).toContain("**delete** the `last_verified` line");
  });

  /**
   * The stamp says something about one document, so it cannot be gated on the
   * slice's verdict: a five-document slice held open by one bad document would
   * otherwise end with all five unstamped, and the sweep that selects on a
   * missing stamp would re-verify four documents found clean three times.
   * This is the one assertion pinning that decision.
   */
  test("the stamp rule does not depend on the slice verdict", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("Do this on every round, whatever Step 6 wrote.");
  });

  test("an absent stamp is the verification-pending marker", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain('says "verification pending"');
  });

  test("verify leaves the generated documents' frontmatter alone", async () => {
    const out = await render("verify-domain-documentation");
    // Both are rewritten wholesale by `generate-navigation` and are write-denied
    // by the agent profile, so a stamp attempt burns turns and changes nothing.
    expect(out).toContain("regenerated from the corpus on");
    expect(out).toContain("saaga-docs/GLOSSARY.md");
  });

  test("fix never restores a stamp verification removed", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("**Never write `last_verified`.**");
  });

  /**
   * The fixer edits documents the report never named — a Coverage Gap closed
   * in an existing doc rather than the `(missing)` path, and every INDEX.md it
   * touches in Step 4. Verification left those stamps standing, so without
   * this the invariant "a stamp means nothing has edited the document since it
   * was verified" is false for exactly the documents the fixer changed.
   */
  test("fix unstamps the documents it edits that the report did not name", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain(
      "**Delete `last_verified` from any other document you edit.**",
    );
    expect(out).toContain("updating an INDEX.md in Step 4");
  });

  test("the frontmatter rules say an absent stamp means pending", async () => {
    const out = await render("slice-doc");
    expect(out).toContain(
      "how the pipeline marks a document as pending verification",
    );
  });

  test("verify takes the date from the flow rather than computing one", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("Use this value verbatim; do not compute a date yourself.");
  });

  test("quick-update preserves frontmatter and never bumps last_verified", async () => {
    const out = await render("quick-update");
    expect(out).toContain("Preserve the YAML frontmatter block exactly as it is");
    expect(out).toContain("**Never touch `last_verified`**");
  });

  test("quick-update emits frontmatter on new documents", async () => {
    const out = await render("quick-update");
    expect(out).toContain("Start every new file with a YAML frontmatter block");
  });

  test("the writer is told sources must cover every claim", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("The test is per claim, not per topic");
    expect(out).toContain("cannot be flagged when that file changes");
  });

  test("verify audits sources completeness", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("**Step 4: Sources Completeness**");
    expect(out).toContain(
      "Frontmatter `sources` lists every file the document makes a claim about",
    );
  });
});

describe("planning prompts no longer re-emit the methodology", () => {
  const PLAN_PROMPTS = ["plan-init", "plan-update", "plan-verify-quick-updates"];

  test.for(PLAN_PROMPTS)("%s drops the re-emit instructions", async (name) => {
    const out = await render(name);
    expect(out).not.toContain("Include verbatim from the Reference section below");
    expect(out).not.toContain("#### 3. Documentation Templates");
    expect(out).not.toContain("#### 5. Quality Checklists");
  });

  test.for(PLAN_PROMPTS)("%s asks for template deltas instead", async (name) => {
    const out = await render(name);
    expect(out).toContain("Template Adaptations");
    expect(out).toContain("Never paste a template");
  });

  test.for(PLAN_PROMPTS)("%s still carries the templates as reference context", async (name) => {
    const out = await render(name);
    expect(out).toContain("### CONCEPT TEMPLATE");
    expect(out).toContain("do NOT copy any of it into the plan");
  });

  test.for(PLAN_PROMPTS)("%s keeps the frontmatter phases contract", async (name) => {
    const out = await render(name);
    expect(out).toContain("`phases` array");
  });
});

describe("prompt strings the flow tests depend on", () => {
  // The fake agent matches scenarios by prompt substring, and tests/cli/*
  // scrape output paths out of the rendered prompt. Breaking one of these
  // surfaces as "FakeAgent: no scenario matched prompt", so pin them here.
  test("slice-doc keeps its title and phase phrasing", async () => {
    const out = await render("slice-doc");
    expect(out.split("\n")[0]).toBe("# Document a Plan Slice");
    expect(out).toContain("phase) `1`");
  });

  test("plan prompts keep the write-the-plan sentence", async () => {
    for (const name of ["plan-init", "plan-update", "plan-verify-quick-updates"]) {
      const out = await render(name);
      expect(out).toMatch(/Write the plan to `([^`]+)`/);
    }
  });

  test("verify keeps the write-the-status sentence", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toMatch(/Write the verification status to `([^`]+)`/);
  });

  test("verify-architecture keeps its title and the write-the-status sentence", async () => {
    const out = await render("verify-architecture");
    expect(out.split("\n")[0]).toBe("# Verify the Architecture Document");
    expect(out).toMatch(/Write the verification status to `([^`]+)`/);
  });

  // FakeAgent matches by substring and the init tests register a
  // "Document the Architecture" scenario for the writer. If that phrase ever
  // appears in the verifier, the writer's scenario swallows the verify call and
  // the loop silently never runs.
  test("verify-architecture cannot be mistaken for the architecture writer", async () => {
    const out = await render("verify-architecture");
    expect(out).not.toContain("Document the Architecture");
  });

  // tests/cli/* scrape the round, the cap and the report path out of the input
  // block to drive a scenario that stamps frontmatter the way the real agent
  // would. A reword here surfaces there as a null match.
  test.for(["verify-domain-documentation", "verify-architecture"])(
    "%s keeps the lines the flow tests scrape",
    async (name) => {
      const out = await render(name);
      expect(out).toMatch(/Write the verification status to `([^`]+)`/);
      expect(out).toMatch(/Deferred-findings report to write: `([^`]+)`/);
      expect(out).toMatch(/This verification round: `(\d+)` of `(\d+)`/);
      expect(out).toMatch(/Today's date: `([^`]+)`/);
    },
  );
});

describe("the verification threshold passes a slice with minors", () => {
  test("verify passes a slice whose only findings are minor", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain(
      "Write exactly `PASS` if the findings table holds no **Critical** and no **Major**",
    );
    expect(out).toContain("Minor findings do not fail the slice.");
  });

  test("a coverage gap still fails the slice", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain(
      "Step 3d grades every Coverage Gap **Critical** or **Major**",
    );
  });

  // The threshold hands the model a reason to grade a Major down to end the
  // loop early. Nothing can test that it doesn't; the prompt at least says so.
  test("the threshold does not license grading a Major down", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain(
      "A Major\nwritten down as a Minor to end the loop early",
    );
  });

  test("verify-architecture holds PASS back until every declared reference is linked", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("and no **Missing Reference** finding");
    expect(out).toContain("the one **Minor** that still\nholds `PASS` back");
  });

  /**
   * The carve-out is a status rule, not a re-grade: the severity taxonomy is
   * out of scope, and promoting Missing Reference to Major would also change
   * what the fix step prioritises. So Step 6 gates on it while Step 3c and the
   * severity ladder still call it Minor.
   */
  test("the missing-reference carve-out is not a severity re-grade", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("**Missing Reference** finding (**Minor**)");
    expect(out).toContain("a declared reference with no link");
  });

  test("verify-architecture has one document, so the findings table alone decides the stamp", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("**The findings table is empty**");
    expect(out).toContain("**The table holds even one row, of any severity**");
  });
});

describe("the deferred-findings report", () => {
  test.for(["verify-domain-documentation", "verify-architecture"])(
    "%s is told the concrete path to write",
    async (name) => {
      const out = await render(name);
      expect(out).toContain(FLOW_VARS[name].deferred_minors_path);
      expect(out).toContain("## Step 8: Record Deferred Findings");
    },
  );

  test.for(["verify-domain-documentation", "verify-architecture"])(
    "%s carries the report format",
    async (name) => {
      const out = await render(name);
      expect(out).toContain("# Deferred Findings");
      expect(out).toContain(
        "| Document | Section | Claim | Severity | Evidence | Verdict | Review |",
      );
      // The pending predicate is written into the artifact itself so task 8's
      // consumer does not have to re-derive it.
      expect(out).toContain(
        "pending means the document still\nexists and its frontmatter still has no `last_verified`",
      );
    },
  );

  /**
   * A final-round FAIL *is* handed to the fix step — what it never gets is a
   * verification of the result. The header has to say that, or the audit trail
   * misdescribes half its own rows.
   */
  test.for(["verify-domain-documentation", "verify-architecture"])(
    "%s describes the entries as unverified, not unfixed",
    async (name) => {
      const out = await render(name);
      expect(out).toContain(
        "recorded but never verified as resolved",
      );
      expect(out).toContain("final-round findings whose fix nothing re-checked");
    },
  );

  test("each verifier stamps the report with its own run date", async () => {
    expect(await render("verify-domain-documentation")).toContain(
      "Recorded 2026-08-29",
    );
    expect(await render("verify-architecture")).toContain("Recorded 2026-08-30");
  });

  // Only the round that ends the slice writes, so each file has exactly one
  // writer and a finding a later round fixed never reaches the ledger.
  test("only the terminal round records anything", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("is equal to the cap, `3`");
    expect(out).toContain("Write nothing when the findings table is empty");
  });

  test("the report excludes documents that can never carry a stamp", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain(
      "Leave out any row whose Document is `README.md` or `GLOSSARY.md`",
    );
  });

  /**
   * A Coverage Gap names a `(missing)` path, and the fix step that runs after
   * a final-round FAIL may create that document — unstamped, and with no other
   * record of why. The consumer's "document exists" test discards the row on
   * its own if the fixer never created it.
   */
  test("the report keeps a coverage gap's missing target", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("Keep a row whose Document is marked `(missing)`");
    expect(out).toContain(
      "a reader checks that the document exists before acting on it",
    );
  });

  test("verify-architecture supplies the Document column it does not have", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain(
      "write `saaga-docs/ARCHITECTURE.md` into\nthe report's Document column",
    );
  });

  test.for(["verify-domain-documentation", "verify-architecture"])(
    "%s says the round number does not change the grading",
    async (name) => {
      const out = await render(name);
      expect(out).toContain(
        "exactly as you would have graded it\non the first",
      );
    },
  );
});

describe("consumer prompts reference only plan sections the plan still emits", () => {
  const CONSUMERS = ["slice-doc", "verify-domain-documentation", "fix-documentation"];
  const PLAN_PROMPTS = ["plan-init", "plan-update", "plan-verify-quick-updates"];

  // Sections the slim plan dropped. A consumer prompt that still sends the
  // agent looking for one of these makes it hunt for a heading that is never
  // written, and miss whatever replaced it.
  const REMOVED_PLAN_SECTIONS = [
    "Verification Requirements",
    "Lessons Learned",
    "Mandatory Verification Protocol section of the plan",
  ];

  test.for(CONSUMERS)("%s does not point at a removed plan section", async (name) => {
    const out = await render(name);
    for (const section of REMOVED_PLAN_SECTIONS) {
      expect(out).not.toContain(section);
    }
  });

  test.for(CONSUMERS)("%s points at Template Adaptations instead", async (name) => {
    const out = await render(name);
    expect(out).toContain("Template Adaptations");
  });

  // The heading text is the contract, not its ordinal: the three plan formats
  // do not have the same sections, so their numbering drifts apart whenever one
  // of them gains a section the others do not need.
  test.for(PLAN_PROMPTS)("%s actually emits Template Adaptations", async (name) => {
    const out = await render(name);
    expect(out).toMatch(/#### \d+\. Template Adaptations/);
    expect(out).toContain("**Verification checks**");
  });
});

/**
 * Task 4: the level-of-detail policy. Static rules (budgets table, consequence
 * test, amortization) live in `partials/lod-policy.md` and must reach every
 * prompt that writes or judges a document; the dynamic rules (per-document
 * budgets, the churn-proportional diff budget) live in the planning prompts,
 * because they produce per-run decisions recorded in the plan.
 */

/** Every prompt file under `prompts/`. All of them now carry flow vars. */
const EVERY_PROMPT = ALL_PROMPTS;

describe("the LOD policy reaches every prompt that writes or judges a document", () => {
  const CONSUMERS = [
    "slice-doc",
    "verify-domain-documentation",
    "fix-documentation",
    "quick-update",
    "plan-init",
    "plan-update",
    "plan-verify-quick-updates",
  ];

  test.for(CONSUMERS)("%s carries the budgets and the consequence test", async (name) => {
    const out = await render(name);
    expect(out).toContain("### Length Budgets");
    expect(out).toContain("### The Consequence Test");
    expect(out).toContain("### Amortization");
  });

  test.for(["slice-doc", "verify-domain-documentation"])(
    "%s carries the tier bands verbatim",
    async (name) => {
      const out = await render(name);
      expect(out).toContain("100–200 lines");
      expect(out).toContain("60–120 lines");
      expect(out).toContain("25–60 lines");
      expect(out).toContain("centrality, not source size");
    },
  );

  test.for(["slice-doc", "verify-domain-documentation"])(
    "%s carries both canonical consequence-test examples",
    async (name) => {
      const out = await render(name);
      // The positive example: its output IS the user interface.
      expect(out).toContain("its output *is* the\nuser-facing audit summary");
      // The negative example: cosmetics with zero dependents.
      expect(out).toContain("braille glyph sequence");
      expect(out).toContain("120 ms frame interval");
    },
  );
});

describe("the planning prompts assign budgets and cap growth", () => {
  const PLAN_PROMPTS = ["plan-init", "plan-update", "plan-verify-quick-updates"];

  test.for(PLAN_PROMPTS)("%s asks for a per-document line budget", async (name) => {
    const out = await render(name);
    expect(out).toContain("**Line budgets**");
    expect(out).toContain("<Core|Supporting|Peripheral>, <N> lines");
  });

  // The diff budget caps growth, never corrections: capping documents *touched*
  // would tell the model to leave a known-stale document alone, which is the one
  // failure mode this corpus has actually been measured to have.
  test.for(["plan-update", "quick-update"])("%s caps growth, not corrections", async (name) => {
    const out = await render(name);
    expect(out).toContain("no limit on corrections");
    expect(out).toContain("may get *longer*");
    expect(out).toContain("genuinely new concept");
  });

  test("plan-update records the diff budget where a reviewer will see it", async () => {
    const out = await render("plan-update");
    expect(out).toContain("### 2d. Diff Budget");
    expect(out).toContain("State the **diff budget** from Step 2d here");
  });
});

describe("verify and fix can act on a budget", () => {
  test("verify extracts the budget and enforces it with a tolerance", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("### 3e. Budget and Level of Detail");
    expect(out).toContain("The **line budget** recorded for each document");
    expect(out).toContain("Below 1.2x the budget: no finding");
    expect(out).toContain("**Budget Overrun**");
    expect(out).toContain("**Consequence Test**");
  });

  test("verify leaves documents it was given no budget for alone", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("Skip any document the plan assigned no budget");
  });

  // A Budget Overrun is only raised when deleting the named passages can
  // actually close the gap. Without this, a document that is over budget but
  // entirely justified produces a finding nothing can resolve, and the slice
  // burns all three fix iterations before the loop exits silently.
  test("an overrun the fix step cannot resolve is not an error", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("**If removing those passages would bring the document within its budget**");
    expect(out).toContain("**If the document is over budget but every passage earns its place**");
    expect(out).toContain("The budget was set wrong, not the document");
    expect(out).toContain("never raise one without the list");
  });

  // Step 3e grades a 1.5x overrun Major, so Step 4's severity definitions have
  // to have a Major case for it — otherwise the same finding is gradeable both ways.
  test("the severity ladder agrees with Step 3e", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("a document at or above 1.5x its assigned budget");
    expect(out).toContain("including a document modestly over its budget");
  });

  test("fix never invents a deletion to hit the number", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("never delete something the report did not name");
  });

  // The checklists reach the verifier in the same rendered prompt as Step 3e.
  // An item asserting "within its budget" would fail a document at 1.1x that
  // 3e deliberately passes, and send the fixer after accurate text.
  test("the checklists defer to the verification step's tolerance", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).not.toContain("Document is within its assigned line budget");
    expect(out).toContain("the verification step defines the tolerance");
  });

  test("fix is allowed to delete accurate text for a budget finding", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain(
      "does not apply to a Budget Overrun, Consequence Test or Duplication finding",
    );
    expect(out).toContain("If it is a **Budget Overrun**");
    expect(out).toContain("If it is a **Consequence Test** finding");
  });
});

describe("the transcription rewards are gone", () => {
  // Each of these strings paid for length: they scored completeness of internal
  // helpers, or gave a private function a home instead of a deletion.
  const REMOVED = [
    'move to "Internal Implementation" section',
    'add it to an "Internal Implementation" note instead',
    'move it from "Key Services" to "Internal Implementation"',
    "All constants/values lists are complete",
    "At least 2 reference implementations are cited",
    "Target Length",
  ];

  test.for(EVERY_PROMPT)("%s contains no transcription reward", async (name) => {
    const out = await render(name);
    for (const phrase of REMOVED) {
      expect(out).not.toContain(phrase);
    }
  });

  test("the Internal Implementation section is gated, not merely offered", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("## Internal Implementation (optional)");
    expect(out).toContain("Include this section only for mechanisms that pass the consequence test");
    expect(out).not.toContain("They are documented for understanding the internal logic");
  });

  test("quick-update no longer trades length for coverage", async () => {
    const out = await render("quick-update");
    expect(out).not.toContain("err on the side of documenting it");
    expect(out).toContain("Err toward coverage, never toward length");
  });
});

/**
 * Task 5: the taxonomy. Two template relaxations (optional concept sections, a
 * Mechanism heading for machinery) and a fourth category, conventions, kept
 * apart from patterns by a line stated the same way everywhere: a rule you can
 * grep for is a convention, a rule you have to read a code flow to follow is a
 * pattern. The category is optional — a repository with no lexical rules gets
 * no `conventions/` directory — so the prompts must never assume it exists.
 */

/** The phrasing of the patterns/conventions split, asserted verbatim. */
const HARD_LINE_PATTERN = "A rule that requires reading code flow is a **pattern**";
const HARD_LINE_CONVENTION = "A rule you could check with grep is a **convention**";

describe("the conventions category reaches the prompts that write and judge documents", () => {
  const CONSUMERS = [
    "slice-doc",
    "verify-domain-documentation",
    "fix-documentation",
    "plan-init",
    "plan-update",
    "plan-verify-quick-updates",
  ];

  test.for(CONSUMERS)("%s carries the convention template", async (name) => {
    const out = await render(name);
    expect(out).toContain("### CONVENTION TEMPLATE");
    expect(out).toContain("type: convention");
    expect(out).toContain("saaga-docs/conventions/{family}.md");
  });

  test.for(CONSUMERS)("%s states the patterns/conventions line", async (name) => {
    const out = await render(name);
    expect(out).toContain(HARD_LINE_PATTERN);
    expect(out).toContain(HARD_LINE_CONVENTION);
  });

  test("quick-update states the line from its own inlined template list", async () => {
    // quick-update includes no template partials — it carries an abbreviated
    // copy — so it needs the rule spelled out rather than inherited.
    const out = await render("quick-update");
    expect(out).toContain(HARD_LINE_PATTERN);
    expect(out).toContain(HARD_LINE_CONVENTION);
    expect(out).toContain("saaga-docs/conventions/{family}.md");
  });

  test("the convention template is itself within the cap it imposes", async () => {
    // The category's own acceptance criterion: a template that cannot model the
    // brevity it demands would not be believed.
    const partial = await readFile(
      resolve(PROMPTS_DIR, "partials/convention-template.md"),
      "utf8",
    );
    expect(partial.trimEnd().split("\n")).toHaveLength(20);
  });

  test("a convention document carries no sources", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("a convention document always does");
  });

  test("the planner looks for convention families and may find none", async () => {
    const out = await render("plan-init");
    expect(out).toContain("### 1d. Identify Convention Families");
    expect(out).toContain("one family per plan entry, never one per");
    expect(out).toContain("Do not invent conventions to fill the category.");
    // The directory is conditional: an empty category is worse than none.
    expect(out).toContain("only if** Step 1d found at least one convention family");
  });

  test("conventions are their own trailing phase, never phase 0", async () => {
    // Phase 0 runs outside the verify/fix loop in flows/init.flow.yaml, so a
    // document placed there is the one thing nothing verifies.
    const out = await render("plan-init");
    expect(out).toMatch(/#### \d+\. Final Phase: Conventions/);
    expect(out).toContain("the last numbered phase, never Phase 0");
  });

  test("no planning prompt assigns a budget to a convention", async () => {
    // The two rules would otherwise collide head-on: "assign a budget to every
    // document listed above — do not omit it" against a 20-line cap whose
    // lowest budget band starts at 25. A planner obeying the budget rule would
    // order the writer straight past the cap and validate-docs would fail the
    // run at the very end, after every token was already spent.
    for (const name of ["plan-init", "plan-update", "plan-verify-quick-updates"]) {
      const out = await render(name);
      expect(out).toContain(
        "the lowest band starts at 25 lines and the cap is 20",
      );
    }
  });

  test("the budget policy itself carves conventions out", async () => {
    // Stated once where the bands are defined, so a prompt that grows a new
    // budget instruction inherits the exemption rather than re-deriving it.
    const out = await render("slice-doc");
    expect(out).toContain("A convention document never gets one");
  });

  test("the update-family prompts treat the category as optional", async () => {
    for (const name of ["plan-update", "plan-verify-quick-updates"]) {
      const out = await render(name);
      expect(out).toContain("saaga-docs/conventions/INDEX.md` is optional");
      expect(out).toContain("Its absence is not an issue.");
    }
  });
});

describe("the templates bend where the subject does not fit", () => {
  test("the concept template's Configuration and Data Storage are optional", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("## Configuration (optional)");
    expect(out).toContain("## Data Storage (optional)");
    expect(out).toContain("`Configuration` and `Data Storage` are optional.");
  });

  test("a concept defines and links rather than narrating a mechanism", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("A concept does not narrate process");
  });

  test("a feature picks User Flow or Mechanism by who the actor is", async () => {
    const out = await render("slice-doc");
    expect(out).toContain("Use `### User Flow` when a person performs the steps");
    expect(out).toContain("Use `### Mechanism` when the");
  });

  test("verify passes a justified omission and fails a stub", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("A section the template marks optional is not required.");
    expect(out).toContain("finding only when the subject demonstrably has the thing");
    expect(out).toContain('stub, on the other hand, **is** a finding');
  });

  test("the plan prompts no longer offer a rename that is now built in", async () => {
    // "rename User Flow to Execution Flow for engine features" was the worked
    // example of a template delta; Mechanism makes it a standing option, and an
    // example contradicting the template invites a pointless adaptation.
    for (const name of ["plan-init", "plan-update", "plan-verify-quick-updates"]) {
      const out = await render(name);
      expect(out).not.toContain("rename User Flow");
      expect(out).toContain("they are not deltas and do not belong here");
    }
  });
});

/**
 * Task 6: single home per fact. The static half — who owns which class of fact,
 * the tie-break, and what a reference looks like instead of a copy — lives in
 * `partials/single-home.md` and must reach every prompt that writes or judges a
 * document. The dynamic half is the per-document owns/references declaration the
 * planners record, which is what the verifier's Step 3f checks against.
 *
 * ARCHITECTURE.md is the case that motivated the task: 689 lines, generated
 * before any plan exists and outside the per-phase verify/fix loop, so nothing
 * held it to the "concise" and "public interface only" rules its own prompt
 * already stated.
 */

describe("the ownership rules reach every prompt that writes or judges a document", () => {
  const CONSUMERS = [
    "slice-doc",
    "verify-domain-documentation",
    "fix-documentation",
    "quick-update",
    "plan-init",
    "plan-update",
    "plan-verify-quick-updates",
    "document-architecture",
    "verify-architecture",
  ];

  test.for(CONSUMERS)("%s carries the ownership rules", async (name) => {
    const out = await render(name);
    expect(out).toContain("## Single Home per Fact");
    expect(out).toContain("### Who Owns What");
    expect(out).toContain("Every fact has exactly one owning document");
  });

  test.for(CONSUMERS)("%s carries the tie-break and the test", async (name) => {
    const out = await render(name);
    // Which of two candidate documents owns a fact, when both could.
    expect(out).toContain("the owner is the one the fact\nis *about*");
    // The check a writer can apply before writing a section, not after.
    expect(out).toContain(
      "If changing one line of source would require editing two documents",
    );
  });

  // The three fact classes the analysis found duplicated in this repo's corpus.
  test.for(CONSUMERS)("%s carries the fact-class table rows", async (name) => {
    const out = await render(name);
    expect(out).toContain("A flow's or workflow's step sequence");
    expect(out).toContain("The CLI surface — subcommands, flags, exit codes");
    expect(out).toContain("A module's public interface");
  });
});

describe("the planning prompts declare ownership per document", () => {
  const PLAN_PROMPTS = ["plan-init", "plan-update", "plan-verify-quick-updates"];

  test.for(PLAN_PROMPTS)("%s asks for an owns/references line", async (name) => {
    const out = await render(name);
    expect(out).toContain("**Owns / references**");
    expect(out).toContain(
      "`<path> — owns: <fact classes>; references: <paths it links to instead of restating>`",
    );
  });

  // The declaration is inert unless something enforces it, and the fixer can act
  // only on a finding that names the owner. Both halves have to be asked for.
  test.for(PLAN_PROMPTS)("%s says the verifier enforces the declaration", async (name) => {
    const out = await render(name);
    expect(out).toContain(
      "A fact named in one document's `owns` must not appear in another document's body",
    );
  });
});

describe("ARCHITECTURE.md gets a budget and a diet", () => {
  // The writer runs before any plan exists, so it cannot read a budget from one.
  // It gets a scaling target instead; the plan carries the number the verifier
  // grades against. Two homes, because they answer at two different times.
  test("the writer gets a scaling target it can compute on its own", async () => {
    const out = await render("document-architecture");
    expect(out).toContain("## Length Budget");
    expect(out).toContain("at most 8 lines per module");
    expect(out).toContain("at most 250 lines, frontmatter included");
    expect(out).toContain("60 + 8 x (number of modules)");
  });

  test("the writer is told to link rather than inline", async () => {
    const out = await render("document-architecture");
    expect(out).toContain("It is the map, not the territory");
    expect(out).toContain("Per-module export lists");
    expect(out).toContain("blocks describing non-exported helpers");
    expect(out).toContain("A walkthrough of the CLI");
  });

  // At init nothing else is on disk yet, so the writer cannot link to documents
  // that do not exist. Saying so explicitly stops it from inlining the content
  // "because there was nothing to link to".
  test("the writer is told why it cannot link during init", async () => {
    const out = await render("document-architecture");
    expect(out).toContain("there are no other documents on disk yet");
    expect(out).toContain("a later verification pass adds the links");
  });

  test("the LOD policy carves ARCHITECTURE out of the tier bands", async () => {
    const out = await render("document-architecture");
    expect(out).toContain("`ARCHITECTURE.md` is the other exception: it has no tier");
  });

  test("plan-init records the budget and the ownership declaration", async () => {
    const out = await render("plan-init");
    expect(out).toContain("#### 3. Architecture Document");
    expect(out).toContain("`ARCHITECTURE.md — <N> lines`");
    expect(out).toContain("`ARCHITECTURE.md — owns: <fact classes>; references: <paths>`");
  });

  // Without a budget in the update plan, verify's Step 3e skips the document by
  // its own rule ("skip any document the plan assigned no budget") — so the diet
  // would decay on the first update run after init trimmed it.
  test("plan-update also budgets ARCHITECTURE, or 3e silently skips it", async () => {
    const out = await render("plan-update");
    expect(out).toContain("#### 6. ARCHITECTURE.md Update Phase (conditional)");
    expect(out).toContain("`ARCHITECTURE.md — <N> lines`");
    expect(out).toContain("the verifier's budget check skips the\n  document entirely");
  });

  // The update flow routes its ARCHITECTURE phase through the shared verifier,
  // whose Step 2 otherwise only looks in the four category directories.
  test("the shared verifier picks ARCHITECTURE up when a phase names it", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("If the phase definition names `saaga-docs/ARCHITECTURE.md`");
    expect(out).toContain("It is the one document with no type template");
  });
});

describe("verify and fix can act on a duplication finding", () => {
  test("the shared verifier checks declared references are not restated", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("### 3f. Ownership and Duplication");
    expect(out).toContain("Skip any document the plan gave no owns / references declaration");
    expect(out).toContain("**Duplication** (Step 3f)");
  });

  // Same contract as the budget findings: the fixer edits only what the report
  // names, so a finding without the passage and the owner is unactionable.
  test("a duplication finding must name the passage and the owner", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain(
      "Name the exact passage in the\n   Evidence column and name the owning document",
    );
  });

  test("verify-architecture grades the budget the same way 3e does", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("Below 1.2x the budget: no finding");
    expect(out).toContain("**If the document is over budget but every passage earns its place**");
    expect(out).toContain("The budget was set wrong, not the document");
  });

  test("verify-architecture skips the budget check when the plan set none", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("skip Step 3b entirely — do not invent a number");
  });

  test("verify-architecture reports the ARCHITECTURE-shaped duplication classes", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("### 3c. Ownership and Duplication");
    expect(out).toContain("A per-module export list");
    expect(out).toContain("rather\n  than one paragraph naming the subcommands and a link");
  });

  // A link to a document no phase will ever create fails validate-docs at the
  // very end of the run, after every token is already spent.
  test("the fixer may only link to a document the plan lists", async () => {
    const forVerify = await render("verify-architecture");
    expect(forVerify).toContain("Name as the owner only a document path the plan lists");
    const forFix = await render("fix-documentation");
    expect(forFix).toContain("Link **only** to a path the plan lists");
  });

  test("fix has a duplication branch that replaces the passage with a link", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("If it is a **Duplication** finding");
    expect(out).toContain("one sentence of context plus a relative link");
    // A "short summary so the reader need not follow the link" is the same
    // duplication in fewer words, and it survives every deletion pass.
    expect(out).toContain("that recreates the duplication in shorter form");
  });

  // Found by the first real run: the fixer only ever *replaces* a duplicated
  // passage with a link, so a reference the plan declared but the writer never
  // duplicated never became one. On an init the writer has no documents to link
  // to yet, so that is every reference — ARCHITECTURE ended up a dead end.
  test("verify-architecture flags a declared reference that was never linked", async () => {
    const out = await render("verify-architecture");
    expect(out).toContain("**Missing Reference** finding (**Minor**)");
    expect(out).toContain("For every path in the plan's `references` list");
    expect(out).toContain("every declared reference is missing");
  });

  test("fix can add a missing link without restating the target", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("If it is a **Missing Reference** finding: add the link");
    expect(out).toContain("Do not restate what the target says");
  });

  // Found by the sample regeneration: ARCHITECTURE landed at exactly its budget
  // (172/172) and then had 23 links added. Woven into existing sentences that is
  // 199 lines — inside the 1.2x tolerance. Added as 23 new sentences it would
  // have overrun, and the next iteration's fix would have deleted real content
  // to get back under. The margin was 7 lines, so this cannot be left to taste.
  test.for(["slice-doc", "fix-documentation", "document-architecture", "verify-architecture"])(
    "%s says a reference costs a link, not a paragraph",
    async (name) => {
      const out = await render(name);
      expect(out).toContain("**A reference costs a link, not a paragraph.**");
      expect(out).toContain('never collect\nlinks into a trailing "See also" list');
    },
  );

  test("fix weaves a missing link in rather than appending a sentence", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("Weave it into the sentence the finding names");
    expect(out).toContain("write a new sentence only when that section has no sentence the link fits");
    expect(out).toContain("A document at its budget must still be at its budget when you are done");
  });

  test("fix knows the architecture slice has no phase definition", async () => {
    const out = await render("fix-documentation");
    expect(out).toContain("When the phase/slice number given above is `architecture`");
    expect(out).toContain("**Architecture Document**");
  });
});


/**
 * Task 10: doc *length* has a downward force (the per-document budgets); doc
 * *count* had none, and it is the one axis a planner can inflate without any
 * rule saying no. The ceiling is enforced by a deterministic gate, so the
 * prompt states the rule and the gate decides the numbers.
 */
describe("the corpus budget constrains plan-init", () => {
  test("plan-init carries both ceilings and the formula behind them", async () => {
    const out = await render("plan-init");

    expect(out).toContain("### Corpus Budget");
    expect(out).toContain("one per 420 lines of source");
    expect(out).toContain("0.25 documented lines per line of source");
    expect(out).toContain("tests excluded");
  });

  test("the ceilings are the gate's, not the plan's", async () => {
    const out = await render("plan-init");

    expect(out).toContain("A deterministic gate derives the same two ceilings");
    expect(out).toContain("informational");
  });

  test("plan-init carries the document-existence test", async () => {
    const out = await render("plan-init");

    expect(out).toContain("**The document-existence test.**");
    expect(out).toContain(
      "A peripheral file becomes a row in the table of the document it belongs to",
    );
    expect(out).toContain("never a file of its own");
  });

  test("over budget means fewer documents, not thinner ones", async () => {
    const out = await render("plan-init");

    expect(out).toContain("cut document **count**");
    expect(out).toMatch(/Do not shave the per-document\s+budgets to fit/);
  });

  // The first attempt has no report; the loop overwrites one fixed path, so a
  // retry reads the previous attempt's verdict.
  test("a retry is told to read the previous attempt's report", async () => {
    const out = await render("plan-init");

    expect(out).toContain("/run/plan-budget-report.md");
    expect(out).toMatch(/a previous attempt at this plan exceeded the corpus\s+ceiling/);
    expect(out).toContain("**fewer documents**");
  });

  // The budget bands belong to the LOD policy; restating them here would give
  // the planner two sources for one rule.
  test("the corpus rule does not restate the per-document bands", async () => {
    const out = await render("plan-init");
    const section = out.slice(
      out.indexOf("### Corpus Budget"),
      out.indexOf("### Plan File Format"),
    );

    expect(section).not.toContain("100–200");
    expect(section).not.toContain("Peripheral");
  });
});
