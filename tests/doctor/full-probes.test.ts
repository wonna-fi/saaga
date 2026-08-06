import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { runFullSideEffectProbes } from "../../src/doctor/full-probes.js";

/**
 * The probes build their own scratch repo with a random nonce, so a fake
 * agent has to read the expected content back out of the prompt.
 */
function nonceFrom(prompt: string, label: string): string {
  return new RegExp(`${label}_(\\w+)`).exec(prompt)?.[1] ?? "";
}

describe("diagnosing a failed capability probe", () => {
  test("classifies as policy-denial when it succeeds without the profile", async () => {
    const agent = new FakeAgent({
      "probe-write.txt": {
        exitCode: 0,
        effect: async (opts, prompt) => {
          // Behave as a backend whose restricted profile is too tight: the
          // write only lands when no profile is in force.
          if (opts.permissions) return;
          const nonce = nonceFrom(prompt, "WRITE_NONCE");
          await writeFile(
            join(opts.cwd, "saaga-docs", "probe-write.txt"),
            `WRITE_NONCE_${nonce}`,
          );
        },
      },
    });

    const results = await runFullSideEffectProbes({
      backend: "cursor",
      agent,
      filterIds: ["write-in-cwd"],
      quiet: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].classification).toBe("policy-denial");

    // The retry is the same probe run again with the profile removed.
    expect(agent.calls).toHaveLength(2);
    expect(agent.calls[0].permissions).toBeDefined();
    expect(agent.calls[1].permissions).toBeUndefined();
  });

  test("classifies as backend-failure when it fails either way", async () => {
    const agent = new FakeAgent({ "probe-write.txt": { exitCode: 0 } });

    const results = await runFullSideEffectProbes({
      backend: "cursor",
      agent,
      filterIds: ["write-in-cwd"],
      quiet: true,
    });

    expect(results[0].status).toBe("fail");
    expect(results[0].classification).toBe("backend-failure");
    expect(agent.calls).toHaveLength(2);
  });

  test("leaves a passing probe unclassified and unretried", async () => {
    const agent = new FakeAgent({
      "probe-write.txt": {
        exitCode: 0,
        effect: async (opts, prompt) => {
          const nonce = nonceFrom(prompt, "WRITE_NONCE");
          await writeFile(
            join(opts.cwd, "saaga-docs", "probe-write.txt"),
            `WRITE_NONCE_${nonce}`,
          );
        },
      },
    });

    const results = await runFullSideEffectProbes({
      backend: "cursor",
      agent,
      filterIds: ["write-in-cwd"],
      quiet: true,
    });

    expect(results[0].status).toBe("pass");
    expect(results[0].classification).toBeUndefined();
    expect(agent.calls).toHaveLength(1);
  });

  test("does not retry a restriction probe, where the answer would be meaningless", async () => {
    const agent = new FakeAgent({
      "src/index.ts": {
        exitCode: 0,
        effect: async (opts, prompt) => {
          const nonce = nonceFrom(prompt, "SHOULD_NOT_APPEAR");
          await writeFile(
            join(opts.cwd, "src", "index.ts"),
            `SHOULD_NOT_APPEAR_${nonce}`,
          );
        },
      },
    });

    const results = await runFullSideEffectProbes({
      backend: "cursor",
      agent,
      filterIds: ["write-source-denied"],
      quiet: true,
    });

    expect(results[0].status).toBe("fail");
    expect(results[0].classification).toBeUndefined();
    expect(agent.calls).toHaveLength(1);
  });
});
