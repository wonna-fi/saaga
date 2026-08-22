import { describe, expect, test } from "vitest";
import { listFlows, parseFlowDefinition } from "../../src/engine/loader.js";

describe("parseFlowDefinition", () => {
  test("parses description when present", () => {
    const flow = parseFlowDefinition({
      name: "test-flow",
      description: "A test flow",
      steps: [],
    });
    expect(flow.name).toBe("test-flow");
    expect(flow.description).toBe("A test flow");
    expect(flow.steps).toEqual([]);
  });

  test("description is undefined when absent", () => {
    const flow = parseFlowDefinition({
      name: "test-flow",
      steps: [],
    });
    expect(flow.description).toBeUndefined();
  });

  test("throws when description is not a string", () => {
    expect(() =>
      parseFlowDefinition({
        name: "test-flow",
        description: 42,
        steps: [],
      }),
    ).toThrow("Flow 'description' must be a string");
  });
});

describe("listFlows", () => {
  test("returns all bundled flows sorted by name", async () => {
    const flows = await listFlows();
    expect(flows.length).toBeGreaterThanOrEqual(4);
    const names = flows.map((f) => f.name);
    expect(names).toContain("init");
    expect(names).toContain("update");
    expect(names).toContain("quick-update");
    expect(names).toContain("verify-quick-updates");
    expect(names).toEqual([...names].sort());
  });

  test("each flow has a description", async () => {
    const flows = await listFlows();
    for (const flow of flows) {
      expect(flow.description).toBeDefined();
      expect(typeof flow.description).toBe("string");
    }
  });
});
