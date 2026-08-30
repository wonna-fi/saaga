import { describe, expect, test } from "vitest";
import {
  agentSteps,
  listFlows,
  parseFlowDefinition,
} from "../../src/engine/loader.js";
import type { AgentStep } from "../../src/engine/types.js";

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

describe("agent.model", () => {
  /** The single agent step of a one-step flow. */
  function agentStep(body: Record<string, unknown>): AgentStep {
    const flow = parseFlowDefinition({
      name: "test",
      steps: [{ agent: { prompt: "p", ...body } }],
    });
    return flow.steps[0] as AgentStep;
  }

  test("parses a built-in key", () => {
    expect(agentStep({ model: "high" }).model).toBe("high");
  });

  test("parses a custom key", () => {
    expect(agentStep({ model: "triage" }).model).toBe("triage");
  });

  /**
   * Load-bearing for resume: `flowHash()` hashes the parsed definition, so
   * materializing the default here would change the hash of every flow that
   * does not use the key.
   */
  test("is left absent, not defaulted, when the YAML omits it", () => {
    const step = agentStep({});
    expect("model" in step).toBe(false);
  });

  test("throws when not a string", () => {
    expect(() => agentStep({ model: 42 })).toThrow(
      "'agent.model' must be a string",
    );
  });

  test.each(["High", "2fast", "-x", "", "mo del", "UPPER"])(
    "rejects the malformed key %o",
    (key) => {
      expect(() => agentStep({ model: key })).toThrow("'agent.model' must be");
    },
  );
});

describe("unknown agent step keys", () => {
  test("a mistyped key is rejected rather than silently ignored", () => {
    expect(() =>
      parseFlowDefinition({
        name: "test",
        steps: [{ agent: { prompt: "p", modell: "high" } }],
      }),
    ).toThrow("unknown key 'agent.modell'");
  });

  test("every documented key is accepted together", () => {
    expect(() =>
      parseFlowDefinition({
        name: "test",
        steps: [
          {
            agent: {
              prompt: "p",
              vars: { a: "1" },
              expect_file: "out.md",
              label: "doing a thing",
              model: "low",
            },
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("agentSteps", () => {
  test("descends foreach, loop and if bodies in document order", () => {
    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "top" } },
        {
          foreach: {
            var: "p",
            in: "${phases}",
            do: [
              { agent: { prompt: "in-foreach" } },
              {
                loop: {
                  max: 2,
                  until: "${ok}",
                  do: [
                    { agent: { prompt: "in-loop" } },
                    {
                      if: "${ok}",
                      then: [{ agent: { prompt: "in-if" } }],
                    },
                  ],
                },
              },
            ],
          },
        },
        { script: { name: "not-an-agent" } },
      ],
    });

    expect(agentSteps(flow.steps).map((s) => s.prompt)).toEqual([
      "top",
      "in-foreach",
      "in-loop",
      "in-if",
    ]);
  });
});
