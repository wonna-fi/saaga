import { randomBytes } from "node:crypto";
import { rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { execa, type ResultPromise } from "execa";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface CopilotAgentOptions {
  model: string;
  ci?: boolean;
}

/**
 * Adapter for the GitHub Copilot CLI.
 *
 * Copilot's glob indexer respects `.gitignore`, which interferes with
 * documentation runs that need to read files like `dist/` or build
 * outputs. We rename `.gitignore` to `.gitignore.<hex>.bak` before
 * invoking the CLI and restore it afterwards (including on failure).
 *
 * Copilot restricts file access to `cwd`, its subdirectories, and the
 * system temp directory. `opts.additionalDirs` is granted via `--add-dir`.
 */
export class CopilotAgent implements Agent {
  readonly name = "copilot";
  private readonly model: string;

  constructor(opts: CopilotAgentOptions) {
    this.model = opts.model;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const giPath = resolve(opts.cwd, ".gitignore");
    const suffix = randomBytes(4).toString("hex");
    const giBakPath = resolve(opts.cwd, `.gitignore.${suffix}.bak`);
    const overridden = await tryRename(giPath, giBakPath);

    try {
      const args = [
        "-p",
        prompt,
        "--allow-all-tools",
        "--no-ask-user",
        "--model",
        this.model,
        "--no-auto-update",
      ];
      for (const dir of opts.additionalDirs ?? []) {
        args.push("--add-dir", dir);
      }

      const stdio = buildStdio(opts);

      const proc: ResultPromise = execa("copilot", args, {
        cwd: opts.cwd,
        reject: false,
        signal: opts.signal,
        ...stdio,
      });
      const result = await proc;
      return { exitCode: result.exitCode ?? 1 };
    } finally {
      if (overridden) {
        await tryRename(giBakPath, giPath);
      }
    }
  }
}

function buildStdio(opts: AgentRunOpts): Record<string, unknown> {
  if (!opts.logFile) {
    return { stdio: "inherit" };
  }
  const fileSink = { file: opts.logFile, append: true };
  if (opts.echo) {
    return {
      stdout: ["inherit", fileSink],
      stderr: ["inherit", fileSink],
    };
  }
  return {
    stdout: fileSink,
    stderr: fileSink,
  };
}

async function tryRename(from: string, to: string): Promise<boolean> {
  if (!(await pathExists(from))) return false;
  await rename(from, to);
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
