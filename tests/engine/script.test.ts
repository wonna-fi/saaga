import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

describe("script primitive", () => {
  test("invokes the registered handler with declared args (interpolated)", async () => {
    const handler = vi.fn<ScriptHandler>(async () => "ok");
    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          script: {
            name: "demo",
            file: "${run_dir}/plans/${app}.md",
            number: "0",
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", run_dir: "/runs/abc" },
      {
        agent: new FakeAgent({}),
        cwd: "/work",
        scripts: { demo: handler },
      },
    );

    expect(handler).toHaveBeenCalledOnce();
    const [args, ctx] = handler.mock.calls[0];
    expect(args).toEqual({
      file: "/runs/abc/plans/myapp.md",
      number: "0",
    });
    expect(ctx.cwd).toBe("/work");
  });

  test("set: binds the handler's return value into the flow scope", async () => {
    const phases = [
      { number: 0, title: "Setup" },
      { number: 1, title: "Core" },
    ];
    const producer: ScriptHandler = vi.fn(async () => phases);

    const consumer = vi.fn<ScriptHandler>(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        { script: { name: "produce", set: "phases" } },
        // ${phases.0.title} pulls a scalar out of the bound array so it
        // can be safely interpolated into a string arg.
        { script: { name: "consume", first_title: "${phases.0.title}" } },
      ],
    });

    await runFlow(
      flow,
      {},
      {
        agent: new FakeAgent({}),
        cwd: "/x",
        scripts: { produce: producer, consume: consumer },
      },
    );

    expect(producer).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledOnce();
    expect(consumer.mock.calls[0][0].first_title).toBe("Setup");
  });

  test("throws on unknown script name", async () => {
    const flow = parseFlowDefinition({
      name: "t",
      steps: [{ script: { name: "nope" } }],
    });

    await expect(
      runFlow(flow, {}, { agent: new FakeAgent({}), cwd: "/x", scripts: {} }),
    ).rejects.toThrow(/Unknown script: nope/);
  });
});
