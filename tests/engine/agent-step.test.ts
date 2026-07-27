import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";

describe("agent step invocation", () => {
  test("forwards ${run_dir} from flow scope as additionalDirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
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
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].additionalDirs).toEqual([runDir]);
  });

  test("omits additionalDirs when run_dir is absent from scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
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
          },
        },
      ],
    });

    await runFlow(flow, { app: "myapp", app_path: dir }, { agent: fake, cwd: dir });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].additionalDirs).toBeUndefined();
  });
});
