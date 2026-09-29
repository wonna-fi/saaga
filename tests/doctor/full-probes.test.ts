import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
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
  // Capability retries: 1 initial + 2 retries + 1 unrestricted diagnostic = 4
  test("classifies as policy-denial when it succeeds without the profile", async () => {
    const agent = new FakeAgent({
      "probe-write.txt": {
        exitCode: 0,
        effect: async (opts, prompt) => {
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

    // 1 initial + 2 retries (all restricted, all fail) + 1 unrestricted diagnostic
    expect(agent.calls).toHaveLength(4);
    expect(agent.calls[0].permissions).toBeDefined();
    expect(agent.calls[1].permissions).toBeDefined();
    expect(agent.calls[2].permissions).toBeDefined();
    expect(agent.calls[3].permissions).toBeUndefined();
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
    // 1 initial + 2 retries + 1 unrestricted diagnostic
    expect(agent.calls).toHaveLength(4);
  });

  test("classifies as transient when it passes on retry", async () => {
    let callCount = 0;
    const agent = new FakeAgent({
      "probe-write.txt": {
        exitCode: 0,
        effect: async (opts, prompt) => {
          callCount++;
          if (callCount === 1) return;
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
    expect(results[0].status).toBe("pass");
    expect(results[0].classification).toBe("transient");
    expect(results[0].retries).toBe(1);
    // 1 initial (fail) + 1 retry (pass) — no unrestricted diagnostic needed
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

describe("shell capability probes need output only a command that ran can produce", () => {
  /** An agent that writes `content(cwd)` to the probe's output file. */
  function writing(file: string, content: (cwd: string) => Promise<string>) {
    return new FakeAgent({
      [file]: {
        exitCode: 0,
        effect: async (opts) => {
          await writeFile(join(opts.cwd, "saaga-docs", file), await content(opts.cwd));
        },
      },
    });
  }

  async function status(agent: FakeAgent, id: string) {
    const [result] = await runFullSideEffectProbes({ backend: "codex", agent, filterIds: [id], quiet: true });
    return result.status;
  }

  test("ls -i from the app directory passes; the working directory an agent is told does not", async () => {
    const ran = writing("probe-ls.txt", async cwd => (await execa("ls", ["-i", "src/index.ts"], { cwd })).stdout + "\n");
    expect(await status(ran, "restricted-shell-utility-allowed")).toBe("pass");
    // What an agent whose shell cannot start writes when asked for pwd: the directory it knows.
    const guessed = writing("probe-ls.txt", async cwd => `${cwd}\n`);
    expect(await status(guessed, "restricted-shell-utility-allowed")).toBe("fail");
  });

  test("git log needs the scratch commit's hash, not just its guessable message", async () => {
    const ran = writing("probe-git-log.txt", async cwd => (await execa("git", ["log", "--oneline", "-1"], { cwd })).stdout + "\n");
    expect(await status(ran, "read-only-git-allowed")).toBe("pass");
    const guessed = writing("probe-git-log.txt", async () => "abc1234 initial\n");
    expect(await status(guessed, "read-only-git-allowed")).toBe("fail");
  });
});
