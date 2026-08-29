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
    expect(out).toContain("Is it a Concept, Pattern, or Feature?");
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
    expect(out).toContain("Is it a Concept, Pattern, or Feature?");
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

  test("verify stamps last_verified only on PASS", async () => {
    const out = await render("verify-domain-documentation");
    expect(out).toContain("## Step 7: Stamp `last_verified` (PASS only)");
    expect(out).toContain("set `last_verified: 2026-08-29`");
    expect(out).toContain("If the status was `FAIL`, do not touch any document");
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

  test.for(PLAN_PROMPTS)("%s actually emits Template Adaptations", async (name) => {
    const out = await render(name);
    expect(out).toContain("#### 3. Template Adaptations");
    expect(out).toContain("**Verification checks**");
  });
});
