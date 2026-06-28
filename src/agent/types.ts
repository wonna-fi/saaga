export interface AgentRunOpts {
  cwd: string;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  exitCode: number;
}

export interface Agent {
  name: string;
  run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult>;
}
