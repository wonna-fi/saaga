import { describe, expect, test } from "vitest";
import { listFlows, loadFlow } from "../src/engine/loader.js";
import type { ScriptStep, Step } from "../src/engine/types.js";

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

  test("init stamps the format version as its last step", async () => {
    const flow = await loadFlow("init");
    const last = asScript(flow.steps[flow.steps.length - 1]);

    expect(last).not.toBeNull();
    expect(last!.name).toBe("stamp-format-version");
  });

  test.each(UPDATE_FAMILY)("%s does not stamp the version", async (name) => {
    const flow = await loadFlow(name);
    const names = flow.steps.map((s) => asScript(s)?.name);

    expect(names).not.toContain("stamp-format-version");
  });
});
