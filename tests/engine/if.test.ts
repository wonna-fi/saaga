import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

describe("if primitive", () => {
  test("runs `then` body when the predicate is true", async () => {
    const fix: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          if: '${status} != "PASS"',
          then: [{ script: { name: "fix" } }],
        },
      ],
    });

    await runFlow(
      flow,
      { status: "FAIL" },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { fix } },
    );

    expect(fix).toHaveBeenCalledOnce();
  });

  test("skips `then` body when the predicate is false", async () => {
    const fix: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          if: '${status} != "PASS"',
          then: [{ script: { name: "fix" } }],
        },
      ],
    });

    await runFlow(
      flow,
      { status: "PASS" },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { fix } },
    );

    expect(fix).not.toHaveBeenCalled();
  });

  test("supports nested children that re-read scope vars", async () => {
    const calls: string[] = [];
    const log: ScriptHandler = vi.fn(async (args) => {
      calls.push(args.tag);
    });

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          if: "${n} < 3",
          then: [
            { script: { name: "log", tag: "first" } },
            { script: { name: "log", tag: "second" } },
          ],
        },
      ],
    });

    await runFlow(
      flow,
      { n: 1 },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { log } },
    );

    expect(calls).toEqual(["first", "second"]);
  });
});
