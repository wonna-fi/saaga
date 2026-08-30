export interface AgentRunOpts {
  cwd: string;
  signal?: AbortSignal;
  /**
   * The run directory for this agent session. The cursor backend uses this
   * to place its cli-config.json under `<runDir>/.cursor-cli/`.
   *
   * Historically named `additionalDirs` because the run directory lived
   * outside the workspace. Now that it lives at `<cwd>/.saaga-runs/`, the
   * path is always under `cwd` and backends no longer need to grant
   * separate filesystem access for it.
   */
  additionalDirs?: string[];
  /**
   * Permission profile for the agent run. Absent means unrestricted —
   * the backend uses its legacy flags (--force, --allow-all-tools, etc.).
   * When present, the backend translates this into its native permission
   * mechanism.
   */
  permissions?: import("./permissions.js").AgentPermissions;
  /** Absolute path to append the agent's stdout/stderr to. */
  logFile?: string;
  /** Also mirror output to the terminal (--verbose). */
  echo?: boolean;
  /**
   * When set, the backend asks its CLI for newline-delimited JSON instead of
   * prose and forwards parsed events here. The log file receives that JSON,
   * so this is opt-in: it trades a readable transcript for machine-checkable
   * permission decisions.
   */
  onEvent?: import("./events.js").AgentEventSink;
  /**
   * Overrides the model bound at construction, for this call only. Set from
   * an agent step's `model:` key so one run can span several models; absent
   * means the backend uses the model it was constructed with.
   */
  model?: string;
}

export interface AgentRunResult {
  exitCode: number;
}

export interface Agent {
  name: string;
  run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult>;
}
