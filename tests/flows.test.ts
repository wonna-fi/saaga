import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { agentSteps, listFlows, loadFlow } from "../src/engine/loader.js";
import { PROMPTS_DIR } from "../src/paths.js";
import { renderPromptFile } from "../src/templates.js";
import type { AgentStep, ScriptStep, Step } from "../src/engine/types.js";

const UPDATE_FAMILY = ["update", "quick-update", "verify-quick-updates"];

/** Every bundled flow. All four write documentation and all four navigate it. */
const ALL_FLOWS = ["init", ...UPDATE_FAMILY];

function asScript(step: Step | undefined): ScriptStep | null {
  return step && step.type === "script" ? step : null;
}

/**
 * Every agent step reachable only from inside a `loop` body. `agentSteps`
 * flattens the whole tree and forgets where each step sat, which is the one
 * thing that matters for a step referencing `${iteration}` or `${loop_max}`.
 */
function agentStepsInsideLoops(steps: Step[], inLoop = false): AgentStep[] {
  const found: AgentStep[] = [];

  for (const step of steps) {
    switch (step.type) {
      case "agent":
        if (inLoop) found.push(step);
        break;
      case "loop":
        found.push(...agentStepsInsideLoops(step.do, true));
        break;
      case "foreach":
        found.push(...agentStepsInsideLoops(step.do, inLoop));
        break;
      case "if":
        found.push(...agentStepsInsideLoops(step.then, inLoop));
        break;
      default:
        break;
    }
  }

  return found;
}

describe("format-version gate wiring", () => {
  test("every bundled flow gates on the format version first", async () => {
    const flows = await listFlows();
    expect(flows.length).toBeGreaterThan(0);

    for (const { name } of flows) {
      const flow = await loadFlow(name);
      const first = asScript(flow.steps[0]);
      expect(first, `${name}: first step is not a script step`).not.toBeNull();
      expect(first!.name, `${name}: first step`).toBe("check-format-version");
    }
  });

  test("init gates in init mode", async () => {
    const flow = await loadFlow("init");
    expect(asScript(flow.steps[0])!.args.mode).toBe("init");
  });

  test.each(UPDATE_FAMILY)("%s gates in update mode", async (name) => {
    const flow = await loadFlow(name);
    expect(asScript(flow.steps[0])!.args.mode).toBe("update");
  });

  test("init stamps the format version after generating the baseline", async () => {
    const flow = await loadFlow("init");
    const names = flow.steps.map((s) => asScript(s)?.name);

    expect(names).toContain("stamp-format-version");
    expect(names.indexOf("stamp-format-version")).toBeGreaterThan(
      names.indexOf("generate-baseline"),
    );
  });

  test.each(UPDATE_FAMILY)("%s does not stamp the version", async (name) => {
    const flow = await loadFlow(name);
    const names = flow.steps.map((s) => asScript(s)?.name);

    expect(names).not.toContain("stamp-format-version");
  });
});

/** Every script step in the flow, including ones nested in foreach/loop/if. */
function scriptSteps(steps: Step[]): ScriptStep[] {
  const out: ScriptStep[] = [];
  for (const step of steps) {
    switch (step.type) {
      case "script":
        out.push(step);
        break;
      case "foreach":
      case "loop":
        out.push(...scriptSteps(step.do));
        break;
      case "if":
        out.push(...scriptSteps(step.then));
        break;
      default:
        break;
    }
  }
  return out;
}

describe("validate-docs wiring", () => {
  /**
   * Structural validation is the last thing every documenting flow does, and it
   * must run *after* the corpus is written: failing earlier would leave the
   * corpus unbaselined (and, for init, unstamped), which makes the next run
   * refuse to start.
   */
  test.each(["init", "update", "quick-update"])(
    "%s validates the corpus after generating the baseline",
    async (name) => {
      const flow = await loadFlow(name);
      const names = scriptSteps(flow.steps).map((s) => s.name);

      expect(names).toContain("validate-docs");
      expect(names.lastIndexOf("validate-docs")).toBeGreaterThan(
        names.lastIndexOf("generate-baseline"),
      );
    },
  );

  test("validate-docs is the last step of init", async () => {
    const flow = await loadFlow("init");
    const last = asScript(flow.steps[flow.steps.length - 1]);

    expect(last).not.toBeNull();
    expect(last!.name).toBe("validate-docs");
  });

  /**
   * `verify-quick-updates` runs `slice-doc` and the verify/fix loop, so it
   * rewrites documents and INDEX rows like any other documenting flow. It was
   * originally left out of validation on the premise that it writes no
   * documentation, which is not true.
   */
  test("verify-quick-updates validates the corpus its verify/fix loop rewrote", async () => {
    const flow = await loadFlow("verify-quick-updates");
    expect(scriptSteps(flow.steps).map((s) => s.name)).toContain("validate-docs");
  });
});

describe("generate-navigation wiring", () => {
  /**
   * The task card said to wire this *after* `validate-docs`. It runs before,
   * so that the validator sees the generated files: that is what makes the
   * card's own acceptance criterion — the orphan check passing on generated
   * output — true within a single run, and it means a generator that emits a
   * broken link fails the run instead of shipping a broken corpus.
   */
  test.each(ALL_FLOWS)(
    "%s generates navigation immediately before validating",
    async (name) => {
      const flow = await loadFlow(name);
      const names = scriptSteps(flow.steps).map((s) => s.name);
      const i = names.indexOf("generate-navigation");

      expect(i, `${name}: no generate-navigation step`).not.toBe(-1);
      expect(names[i + 1], `${name}: step after generate-navigation`).toBe("validate-docs");
    },
  );

  test.each(ALL_FLOWS)(
    "%s passes the app name and corpus location to generate-navigation",
    async (name) => {
      const flow = await loadFlow(name);
      const step = scriptSteps(flow.steps).find((s) => s.name === "generate-navigation");

      expect(step!.args).toEqual({
        app_dir: "${app_path}",
        docs_dir: "${docs_dir}",
        app: "${app}",
      });
    },
  );
});

describe("verify receives an ISO date for the last_verified stamp", () => {
  /**
   * `${date}` is the run-id form (YYYYMMDD) and is NOT a valid frontmatter
   * date; `${iso_date}` is. Passing the wrong one produces a `last_verified`
   * the parser rejects, which silently removes the document from staleness
   * detection — so the wiring is asserted rather than assumed.
   */
  test.each(["init", "update", "verify-quick-updates"])(
    "%s passes iso_date to every verify step",
    async (name) => {
      const flow = await loadFlow(name);
      const verifiers = agentSteps(flow.steps).filter((s) =>
        s.prompt.startsWith("verify-"),
      );

      expect(verifiers.length).toBeGreaterThan(0);
      for (const step of verifiers) {
        expect(step.vars?.date).toBe("${iso_date}");
      }
    },
  );
});

describe("verify receives the round and the deferred-findings report", () => {
  /**
   * The verifier stamps `last_verified` per document and records what it
   * deferred, and both depend on knowing whether this is the last round: a
   * FAIL on the final round is never re-checked, so its findings have to be
   * written down rather than left to a fix step nothing verifies.
   */
  test.each(["init", "update", "verify-quick-updates"])(
    "%s passes the round, the cap and a report path to every verify step",
    async (name) => {
      const flow = await loadFlow(name);
      const verifiers = agentSteps(flow.steps).filter((s) =>
        s.prompt.startsWith("verify-"),
      );

      expect(verifiers.length).toBeGreaterThan(0);
      for (const step of verifiers) {
        expect(step.vars?.iteration).toBe("${iteration}");
        expect(step.vars?.loop_max).toBe("${loop_max}");
        // One report per slice, so each file has exactly one writer: a single
        // run-level file would be appended to by every verifier in the run,
        // and one of them writing instead of appending erases the rest.
        expect(step.vars?.deferred_minors_path).toMatch(
          /^\$\{run_dir\}\/.+\/deferred-minors\.md$/,
        );
      }
    },
  );

  /**
   * `${iteration}` and `${loop_max}` are bound by the loop primitive and exist
   * only inside its body. A verifier hoisted out of a loop would abort the run
   * at var-render time with `Undefined variable`, which is loud but late.
   */
  test.each(["init", "update", "verify-quick-updates"])(
    "every verify step in %s sits inside a loop",
    async (name) => {
      const flow = await loadFlow(name);
      const all = agentSteps(flow.steps).filter((s) =>
        s.prompt.startsWith("verify-"),
      );
      const looped = agentStepsInsideLoops(flow.steps);

      expect(all.length).toBeGreaterThan(0);
      for (const step of all) {
        expect(looped).toContain(step);
      }
    },
  );
});

/**
 * Pins the "behaviour is unchanged" claim: before per-step keys, everything
 * ran on `high` except quick-update, which ran on `medium` (the default).
 */
describe("agent step model keys", () => {
  test.each(["init", "update", "verify-quick-updates"])(
    "every agent step in %s asks for high",
    async (name) => {
      const flow = await loadFlow(name);
      const steps = agentSteps(flow.steps);

      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.model).toBe("high");
      }
    },
  );

  test("quick-update leaves the key off, taking the medium default", async () => {
    const flow = await loadFlow("quick-update");
    const steps = agentSteps(flow.steps);

    expect(steps).toHaveLength(1);
    expect(steps[0].model).toBeUndefined();
  });
});

/**
 * Task 6: ARCHITECTURE.md is generated before the plan exists and outside the
 * per-phase verify/fix loop, so nothing checked it. Its own loop runs after
 * parse-plan — the plan is where its budget and its ownership declaration live —
 * and before the phase-0 slice, so a trimmed document is what the rest of the
 * run reads.
 */
/**
 * `init` has two top-level loops — planning and architecture — so both are
 * located by what they contain. Selecting "the first loop" would silently
 * follow whichever one happens to come first.
 */
function topLevelLoopWith(steps: Step[], prompt: string) {
  const loop = steps.find(
    (s) => s.type === "loop" && agentSteps(s.do).some((a) => a.prompt === prompt),
  );
  if (loop?.type !== "loop") throw new Error(`init has no top-level loop running ${prompt}`);
  return loop;
}

function topLevelIndexOfLoopWith(steps: Step[], prompt: string): number {
  return steps.findIndex(
    (s) => s.type === "loop" && agentSteps(s.do).some((a) => a.prompt === prompt),
  );
}

/** Script steps directly in a step list (one level, no recursion needed here). */
function scriptStepsIn(steps: Step[]): ScriptStep[] {
  return steps.filter((s): s is ScriptStep => s.type === "script");
}

describe("the architecture verify/fix loop in init", () => {
  test("runs after the plan is parsed and before the first slice", async () => {
    const flow = await loadFlow("init");

    // parse-plan lives inside the planning loop, so its position is that loop's.
    const planning = topLevelIndexOfLoopWith(flow.steps, "plan-init");
    const architecture = topLevelIndexOfLoopWith(flow.steps, "verify-architecture");
    const firstSlice = flow.steps.findIndex(
      (s) => s.type === "agent" && s.prompt === "slice-doc",
    );

    expect(planning).toBeGreaterThanOrEqual(0);
    const planningLoop = topLevelLoopWith(flow.steps, "plan-init");
    expect(scriptStepsIn(planningLoop.do).map((s) => s.name)).toContain("parse-plan");

    expect(architecture).toBeGreaterThan(planning);
    expect(firstSlice).toBeGreaterThan(architecture);
  });

  test("verifies and fixes the architecture inside one bounded loop", async () => {
    const flow = await loadFlow("init");
    const loop = topLevelLoopWith(flow.steps, "verify-architecture");

    expect(loop.max).toBe(3);

    const prompts = agentSteps(loop.do).map((s) => s.prompt);
    expect(prompts).toContain("verify-architecture");
    expect(prompts).toContain("fix-documentation");
  });

  // ${status} belongs to the per-phase loop later in the flow. Reusing it here
  // would leave a stale "PASS" in scope and let that loop exit before verifying.
  test("uses its own status variable, not the per-phase one", async () => {
    const flow = await loadFlow("init");
    const loop = topLevelLoopWith(flow.steps, "verify-architecture");

    expect(loop.until).toContain("arch_status");
    expect(loop.until).not.toContain("${status}");
  });
});

/**
 * Task 10: doc *count* is the planner's one unconstrained axis, so planning is
 * retried against a budget derived from the repository. The loop exits silently
 * at its cap, which is why a separate enforce step has to follow it.
 */
describe("the corpus-budget planning loop in init", () => {
  test("plans, parses and checks the budget inside one bounded loop", async () => {
    const flow = await loadFlow("init");
    const loop = topLevelLoopWith(flow.steps, "plan-init");

    expect(loop.max).toBe(3);
    expect(loop.until).toContain("budget.status");

    const scripts = scriptStepsIn(loop.do).map((s) => s.name);
    expect(scripts).toEqual(["parse-plan", "check-plan-budget"]);
    expect(scriptStepsIn(loop.do).at(-1)!.args.mode).toBe("report");
  });

  test("the planner is handed the previous attempt's report", async () => {
    const flow = await loadFlow("init");
    const loop = topLevelLoopWith(flow.steps, "plan-init");
    const planner = agentSteps(loop.do).find((s) => s.prompt === "plan-init")!;
    const gate = scriptStepsIn(loop.do).at(-1)!;

    // One fixed path, not report-${iteration}.md: inside iteration N the planner
    // would be pointed at a report that does not exist until the end of N.
    expect(planner.vars?.budget_report_path).toBe(gate.args.report_path);
    expect(planner.vars?.budget_report_path).not.toContain("${iteration}");
  });

  test("enforces after the loop, because the loop itself never fails", async () => {
    const flow = await loadFlow("init");
    const loopIndex = topLevelIndexOfLoopWith(flow.steps, "plan-init");
    const enforce = flow.steps.findIndex(
      (s) => s.type === "script" && s.name === "check-plan-budget" && s.args.mode === "enforce",
    );
    const firstSlice = flow.steps.findIndex(
      (s) => s.type === "agent" && s.prompt === "slice-doc",
    );

    expect(enforce).toBeGreaterThan(loopIndex);
    expect(firstSlice).toBeGreaterThan(enforce);

    // ${iteration} and ${loop_max} are deleted when the loop exits, so a
    // post-loop step referencing either throws at arg interpolation.
    const step = flow.steps[enforce] as ScriptStep;
    for (const value of Object.values(step.args)) {
      expect(value).not.toContain("${iteration}");
      expect(value).not.toContain("${loop_max}");
    }
  });
});

/**
 * A `{var}` the flow does not pass is left in the rendered prompt verbatim
 * (`src/templates.ts` substitutes leniently), so the agent is handed a literal
 * `{status_path}` to write to and the failure surfaces much later as a missing
 * file — or not at all. The document templates carry deliberate literals like
 * `{family}` and `{method}`, so this checks only the names flows actually supply.
 */
describe("every prompt gets the vars it asks for", () => {
  const FLOW_SUPPLIED = [
    "app",
    "changes_dir",
    "changes_path",
    "date",
    "deferred_minors_path",
    "docs_dir",
    "iteration",
    "loop_max",
    "manifest_path",
    "metadata_dir",
    "output_path",
    "phase_number",
    "plan",
    "review_path",
    "scratch_path",
    "status_path",
    "summary_path",
  ];

  test("no flow-supplied placeholder survives rendering", async () => {
    const flows = await listFlows();
    const missing: string[] = [];

    for (const { name } of flows) {
      const flow = await loadFlow(name);
      for (const step of agentSteps(flow.steps)) {
        // Substitute a sentinel rather than the flow's own `${app}`-style
        // value: that value contains the placeholder as a substring, so the
        // scan below would report every var the flow does supply.
        const vars = Object.fromEntries(
          Object.keys(step.vars ?? {}).map((k) => [k, `<<${k}>>`]),
        );
        const out = await renderPromptFile(
          resolve(PROMPTS_DIR, `${step.prompt}.md`),
          vars,
          { includeRoots: [PROMPTS_DIR] },
        );
        for (const key of FLOW_SUPPLIED) {
          if (out.includes(`{${key}}`)) {
            missing.push(`${name} > ${step.prompt}: {${key}}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

