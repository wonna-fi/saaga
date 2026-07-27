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
 * Adapter for the GitHub Copilot CLI. Mirrors the bash `entrypoint.sh`
 * Copilot path:
 *
 *   copilot -p <prompt> --allow-all-tools --no-ask-user \
 *           --model <model> --no-auto-update
 *
 * Copilot's glob indexer respects `.gitignore`, which interferes with
 * documentation runs that need to read files like `dist/` or build
 * outputs. To match the bash behavior we rename `.gitignore` to
 * `.gitignore.bak` before invoking the CLI and restore it afterwards
 * (including on failure).
 *
 * Copilot restricts file access to `cwd`, its subdirectories, and the
 * system temp directory regardless of `--allow-all-tools` (which only
 * governs tool-approval prompts, not path access). `opts.additionalDirs`
 * — e.g. the Saaga run directory — is granted access via `--add-dir` so
 * the agent can read/write files outside `cwd`.
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
      const proc: ResultPromise = execa("copilot", args, {
        cwd: opts.cwd,
        reject: false,
        signal: opts.signal,
        stdio: "inherit",
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
