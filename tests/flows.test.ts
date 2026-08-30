import { describe, expect, test } from "vitest";
import { agentSteps, listFlows, loadFlow } from "../src/engine/loader.js";
import type { ScriptStep, Step } from "../src/engine/types.js";

const UPDATE_FAMILY = ["update", "quick-update", "verify-quick-updates"];

/** Every bundled flow. All four write documentation and all four navigate it. */
const ALL_FLOWS = ["init", ...UPDATE_FAMILY];

function asScript(step: Step | undefined): ScriptStep | null {
  return step && step.type === "script" ? step : null;
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
      const verifiers = agentSteps(flow.steps).filter(
        (s) => s.prompt === "verify-domain-documentation",
      );

      expect(verifiers.length).toBeGreaterThan(0);
      for (const step of verifiers) {
        expect(step.vars?.date).toBe("${iso_date}");
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
