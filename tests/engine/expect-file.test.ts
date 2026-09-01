import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import {
  ExpectFileMissingError,
  runFlow,
} from "../../src/engine/runner.js";

describe("agent.expect_file", () => {
  test("throws when the declared file is missing after the agent returns success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-expect-"));
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
            expect_file: `${dir}/missing.md`,
          },
        },
      ],
    });

    await expect(
      runFlow(flow, { app: "myapp", app_path: dir }, { agent: fake, cwd: dir }),
    ).rejects.toBeInstanceOf(ExpectFileMissingError);
  });

  test("passes when the agent (simulated) writes the expected file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-expect-"));
    const expected = join(dir, "plans", "myapp-init.plan.md");

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          await mkdir(dirname(expected), { recursive: true });
          await writeFile(expected, "plan content", "utf8");
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
            expect_file: expected,
          },
        },
      ],
    });

    await expect(
      runFlow(flow, { app: "myapp", app_path: dir }, { agent: fake, cwd: dir }),
    ).resolves.toBeUndefined();
  });

  test("interpolates ${...} expressions in the expect_file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-expect-"));
    const expected = join(dir, "out", "salesforce-init.plan.md");

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          await mkdir(dirname(expected), { recursive: true });
          await writeFile(expected, "plan content", "utf8");
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "salesforce" },
            expect_file: "${run_dir}/out/${app}-init.plan.md",
          },
        },
      ],
    });

    await expect(
      runFlow(
        flow,
        { app: "salesforce", app_path: dir, run_dir: dir },
        { agent: fake, cwd: dir },
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * A step that runs more than once against one output path — a retry loop —
   * would otherwise accept the previous attempt's leftover as a fresh answer,
   * spending the remaining attempts on a verdict already reached.
   */
  describe("inside a retry loop", () => {
    function loopFlow(expected: string) {
      return parseFlowDefinition({
        name: "test",
        steps: [
          {
            loop: {
              max: 2,
              // Never satisfied, so the body runs its full two attempts.
              until: '"no" == "yes"',
              do: [
                {
                  agent: {
                    prompt: "document-architecture",
                    vars: { app: "myapp" },
                    expect_file: expected,
                  },
                },
              ],
            },
          },
        ],
      });
    }

    test("an attempt that writes nothing is not passed off as a fresh answer", async () => {
      const dir = await mkdtemp(join(tmpdir(), "saaga-expect-"));
      const expected = join(dir, "plan.md");

      let calls = 0;
      const fake = new FakeAgent({
        "Document the Architecture": {
          exitCode: 0,
          effect: async () => {
            calls++;
            // Only the first attempt writes; the second exits cleanly having
            // produced nothing, leaving the rejected plan on disk.
            if (calls === 1) await writeFile(expected, "first attempt", "utf8");
          },
        },
      });

      await expect(
        runFlow(loopFlow(expected), { app_path: dir, run_dir: dir }, { agent: fake, cwd: dir }),
      ).rejects.toThrow(/left expect_file unchanged/);
    });

    // Judged on the answer, not on novelty: a planner that re-ran and reached
    // the same conclusion did its work.
    test("an attempt that rewrites the same content still counts as produced", async () => {
      const dir = await mkdtemp(join(tmpdir(), "saaga-expect-"));
      const expected = join(dir, "plan.md");

      const fake = new FakeAgent({
        "Document the Architecture": {
          exitCode: 0,
          effect: async () => {
            await writeFile(expected, "identical every time", "utf8");
          },
        },
      });

      await expect(
        runFlow(loopFlow(expected), { app_path: dir, run_dir: dir }, { agent: fake, cwd: dir }),
      ).resolves.toBeUndefined();
    });
  });
});
