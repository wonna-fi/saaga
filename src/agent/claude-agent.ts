import { execa, type ResultPromise } from "execa";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface ClaudeAgentOptions {
  model: string;
  ci?: boolean;
}

export class ClaudeAgent implements Agent {
  readonly name = "claude";
  private readonly model: string;
  private readonly ci: boolean;

  constructor(opts: ClaudeAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = [
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      this.model,
    ];

    args.push(prompt);

    let proc: ResultPromise;
    try {
      proc = execa("claude", args, {
        cwd: opts.cwd,
        reject: false,
        signal: opts.signal,
        stdio: "inherit",
      });
    } catch {
      return { exitCode: 1 };
    }

    const result = await proc;
    return { exitCode: result.exitCode ?? 1 };
  }
}
