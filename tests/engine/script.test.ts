import { Writable } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import { Logger } from "../../src/logger.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

class StringWritable extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: string,
    cb: (e?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    cb();
  }
  get text(): string {
    return this.chunks.join("");
  }
}

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

  /**
   * A script has no logger of its own, so anything it wants to say to the user
   * has to come back through `ctx.warn`. `validate-docs` reports orphan
   * documents this way: real problems, but not ones worth failing a flow over.
   */
  test("ctx.warn reaches the run output", async () => {
    const handler: ScriptHandler = async (_args, ctx) => {
      ctx.warn?.("orphan document: saaga-docs/ARCHITECTURE.md");
      return undefined;
    };
    const stream = new StringWritable();
    const flow = parseFlowDefinition({
      name: "t",
      steps: [{ script: { name: "warner" } }],
    });

    await runFlow(
      flow,
      {},
      {
        agent: new FakeAgent({}),
        cwd: "/x",
        scripts: { warner: handler },
        logger: new Logger({ ci: true, stream }),
      },
    );

    expect(stream.text).toContain(
      "[WARN] orphan document: saaga-docs/ARCHITECTURE.md",
    );
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
