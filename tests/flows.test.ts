import { describe, expect, test } from "vitest";
import { listFlows, loadFlow } from "../src/engine/loader.js";
import type { AgentStep, ScriptStep, Step } from "../src/engine/types.js";

const UPDATE_FAMILY = ["update", "quick-update", "verify-quick-updates"];

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

  test("verify-quick-updates does not validate — it writes no documentation", async () => {
    const flow = await loadFlow("verify-quick-updates");
    expect(scriptSteps(flow.steps).map((s) => s.name)).not.toContain("validate-docs");
  });
});

/** Every agent step in the flow, including ones nested in foreach/loop/if. */
function agentSteps(steps: Step[]): AgentStep[] {
  const out: AgentStep[] = [];
  for (const step of steps) {
    switch (step.type) {
      case "agent":
        out.push(step);
        break;
      case "foreach":
      case "loop":
        out.push(...agentSteps(step.do));
        break;
      case "if":
        out.push(...agentSteps(step.then));
        break;
      default:
        break;
    }
  }
  return out;
}

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
