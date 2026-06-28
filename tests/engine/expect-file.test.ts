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
});
