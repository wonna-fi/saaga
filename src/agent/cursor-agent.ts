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
    const args = [
      "--print",
      "--force",
      "--model",
      this.model,
      "--output-format",
      "text",
    ];

    args.push(prompt);

    const stdio = buildStdio(opts);

    let proc: ResultPromise;
    try {
      proc = execa("cursor-agent", args, {
        cwd: opts.cwd,
        reject: false,
        signal: opts.signal,
        ...stdio,
      });
    } catch {
      return { exitCode: 1 };
    }

    const result = await proc;
    return { exitCode: result.exitCode ?? 1 };
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
