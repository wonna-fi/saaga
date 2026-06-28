import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

describe("read-file primitive", () => {
  test("reads file contents into the variable named by `set:`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-read-"));
    const file = join(dir, "data.txt");
    await writeFile(file, "PASS\n", "utf8");

    const consume: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        { "read-file": { path: file, set: "status" } },
        { script: { name: "consume", s: "${status}" } },
      ],
    });

    await runFlow(
      flow,
      {},
      { agent: new FakeAgent({}), cwd: "/x", scripts: { consume } },
    );

    expect(consume).toHaveBeenCalledOnce();
    // Without trim:true, the trailing newline is preserved.
    expect(consume.mock.calls[0][0].s).toBe("PASS\n");
  });

  test("trims surrounding whitespace when trim:true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-read-"));
    const file = join(dir, "data.txt");
    await writeFile(file, "  PASS\r\n  ", "utf8");

    const consume: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        { "read-file": { path: file, set: "status", trim: true } },
        { script: { name: "consume", s: "${status}" } },
      ],
    });

    await runFlow(
      flow,
      {},
      { agent: new FakeAgent({}), cwd: "/x", scripts: { consume } },
    );

    expect(consume.mock.calls[0][0].s).toBe("PASS");
  });

  test("interpolates ${...} in the path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-read-"));
    const file = join(dir, "review-1.md");
    await writeFile(file, "review body", "utf8");

    const consume: ScriptHandler = vi.fn(async () => undefined);

    const flow = parseFlowDefinition({
      name: "t",
      steps: [
        {
          "read-file": {
            path: "${dir}/review-${i}.md",
            set: "review",
          },
        },
        { script: { name: "consume", v: "${review}" } },
      ],
    });

    await runFlow(
      flow,
      { dir, i: 1 },
      { agent: new FakeAgent({}), cwd: "/x", scripts: { consume } },
    );

    expect(consume.mock.calls[0][0].v).toBe("review body");
  });
});
