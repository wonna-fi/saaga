import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

describe("loop primitive", () => {
  test("body executes once per iteration with ${iteration} bound (1-indexed)", async () => {
    const seen: string[] = [];
    const tick: ScriptHandler = vi.fn(async (args) => {
      seen.push(args.i);
    });

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          loop: {
            max: 3,
            // never satisfied; loop runs to max
            until: '${never} == "yes"',
            do: [{ script: { name: "tick", i: "${iteration}" } }],
          },
        },
      ],
    });

    await runFlow(
      flow,
      { never: "no" },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { tick } },
    );

    expect(seen).toEqual(["1", "2", "3"]);
  });

  test("exits early once `until` predicate becomes true after a body iteration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-loop-"));
    const statusFile = join(dir, "status.txt");
    let iteration = 0;

    const verify: ScriptHandler = vi.fn(async () => {
      iteration++;
      // First iteration FAIL, second PASS.
      await writeFile(
        statusFile,
        iteration === 1 ? "FAIL\n" : "PASS\n",
        "utf8",
      );
    });

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          loop: {
            max: 5,
            until: '${status} == "PASS"',
            do: [
              { script: { name: "verify" } },
              { "read-file": { path: statusFile, set: "status", trim: true } },
            ],
          },
        },
      ],
    });

    await runFlow(
      flow,
      {},
      { agent: new FakeAgent({}), cwd: "/x", scripts: { verify } },
    );

    expect(iteration).toBe(2);
  });

  test("does not exceed `max` iterations even if `until` never holds", async () => {
    const tick: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          loop: {
            max: 4,
            until: "${nope} == 1",
            do: [{ script: { name: "tick" } }],
          },
        },
      ],
    });

    await runFlow(
      flow,
      { nope: 0 },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { tick } },
    );

    expect(tick).toHaveBeenCalledTimes(4);
  });

  test("does not leak ${iteration} into the outer scope", async () => {
    const after: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          loop: {
            max: 1,
            until: "${stop} == 1",
            do: [],
          },
        },
        { script: { name: "after", i: "${iteration}" } },
      ],
    });

    await expect(
      runFlow(
        flow,
        { stop: 0 },
        { agent: new FakeAgent({}), cwd: "/x", scripts: { after } },
      ),
    ).rejects.toThrow();
  });
});
