import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

describe("foreach primitive", () => {
  test("invokes the body once per item with the loop var bound", async () => {
    const handler = vi.fn<ScriptHandler>(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          foreach: {
            var: "phase",
            in: "${phases}",
            do: [
              {
                script: {
                  name: "consume",
                  n: "${phase.number}",
                  t: "${phase.title}",
                },
              },
            ],
          },
        },
      ],
    });

    const phases = [
      { number: 0, title: "Setup" },
      { number: 1, title: "Core" },
      { number: 2, title: "Auth" },
    ];

    await runFlow(
      flow,
      { phases },
      {
        agent: new FakeAgent({}),
        cwd: "/x",
        scripts: { consume: handler },
      },
    );

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0]).toEqual({ n: "0", t: "Setup" });
    expect(handler.mock.calls[1][0]).toEqual({ n: "1", t: "Core" });
    expect(handler.mock.calls[2][0]).toEqual({ n: "2", t: "Auth" });
  });

  test("respects when: predicate (skip phase 0)", async () => {
    const handler = vi.fn<ScriptHandler>(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          foreach: {
            var: "phase",
            in: "${phases}",
            when: "${phase.number} != 0",
            do: [
              { script: { name: "consume", n: "${phase.number}" } },
            ],
          },
        },
      ],
    });

    const phases = [
      { number: 0, title: "Setup" },
      { number: 1, title: "Core" },
      { number: 2, title: "Auth" },
    ];

    await runFlow(
      flow,
      { phases },
      {
        agent: new FakeAgent({}),
        cwd: "/x",
        scripts: { consume: handler },
      },
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0]).toEqual({ n: "1" });
    expect(handler.mock.calls[1][0]).toEqual({ n: "2" });
  });

  test("does not leak the loop var into the surrounding scope", async () => {
    const handler = vi.fn<ScriptHandler>(async () => undefined);
    const after = vi.fn<ScriptHandler>(async (args) => {
      // Reading ${phase} after the foreach should fail.
      return args;
    });

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          foreach: {
            var: "phase",
            in: "${phases}",
            do: [{ script: { name: "consume", n: "${phase.number}" } }],
          },
        },
        { script: { name: "after", x: "${phase.number}" } },
      ],
    });

    const phases = [{ number: 0, title: "x" }];

    await expect(
      runFlow(
        flow,
        { phases },
        {
          agent: new FakeAgent({}),
          cwd: "/x",
          scripts: { consume: handler, after },
        },
      ),
    ).rejects.toThrow();
  });

  test("rejects non-array `in` value", async () => {
    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          foreach: {
            var: "x",
            in: "${notArray}",
            do: [],
          },
        },
      ],
    });

    await expect(
      runFlow(flow, { notArray: "hi" }, { agent: new FakeAgent({}), cwd: "/x" }),
    ).rejects.toThrow(/must resolve to an array/);
  });
});
