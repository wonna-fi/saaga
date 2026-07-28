export interface AgentRunOpts {
  cwd: string;
  signal?: AbortSignal;
  /**
   * Extra directories the agent must be able to read/write in addition to
   * `cwd` (e.g. the Saaga run directory, which lives outside the app
   * directory being documented). Backends that sandbox filesystem access
   * to `cwd` should grant access to these paths explicitly; backends that
   * don't restrict paths may ignore this field.
   */
  additionalDirs?: string[];
  /** Absolute path to append the agent's stdout/stderr to. */
  logFile?: string;
  /** Also mirror output to the terminal (--verbose). */
  echo?: boolean;
}

export interface AgentRunResult {
  exitCode: number;
}

export interface Agent {
  name: string;
  run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult>;
}
