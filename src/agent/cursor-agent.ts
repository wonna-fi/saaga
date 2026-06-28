import { execa, type ResultPromise } from "execa";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface CursorAgentOptions {
  model: string;
  ci?: boolean;
}

export class CursorAgent implements Agent {
  readonly name = "cursor";
  private readonly model: string;
  private readonly ci: boolean;

  constructor(opts: CursorAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = ["--print", "--force", "--model", this.model];

    if (this.ci) {
      args.push("--output-format", "text");
    }

    args.push(prompt);

    let proc: ResultPromise;
    try {
      proc = execa("cursor-agent", args, {
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
