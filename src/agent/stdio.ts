import type { AgentRunOpts } from "./types.js";

/**
 * Build execa stdio options for an agent invocation.
 *
 * When no `logFile` is set, inherits the parent's stdio streams.
 * When `logFile` is set, redirects stdout/stderr to the file (appending).
 * When both `logFile` and `echo` are set, tees to both the terminal and file.
 *
 * Always sets `stdin: "ignore"` — agent CLIs must not block on interactive
 * input during unattended runs.
 */
export function buildStdio(opts: AgentRunOpts): Record<string, unknown> {
  if (!opts.logFile) {
    return { stdin: "ignore", stdout: "inherit", stderr: "inherit" };
  }
  const fileSink = { file: opts.logFile, append: true };
  if (opts.echo) {
    return {
      stdin: "ignore",
      stdout: ["inherit", fileSink],
      stderr: ["inherit", fileSink],
    };
  }
  return {
    stdin: "ignore",
    stdout: fileSink,
    stderr: fileSink,
  };
}

/**
 * Build execa stdio options that pipe stdout through the Node process so
 * callers can parse the event stream (e.g. for `--audit-permissions` denial
 * scanning or probe log capture).
 *
 * Only stdout is piped — stderr goes directly to the log file (or is
 * inherited). Piping stderr too without draining it risks a deadlock: the
 * OS pipe buffer (64 KB on Linux) fills if the backend writes enough
 * warnings or progress output, and the child blocks on write while the
 * parent is only reading stdout.
 *
 * Always writes to `logFile` when provided. Always sets `stdin: "ignore"`.
 */
export function buildPipedStdio(opts: AgentRunOpts): Record<string, unknown> {
  if (!opts.logFile) {
    return { stdin: "ignore", stdout: "pipe", stderr: "inherit" };
  }
  const fileSink = { file: opts.logFile, append: true };
  if (opts.echo) {
    return {
      stdin: "ignore",
      stdout: ["pipe", "inherit", fileSink],
      stderr: ["inherit", fileSink],
    };
  }
  return {
    stdin: "ignore",
    stdout: ["pipe", fileSink],
    stderr: fileSink,
  };
}
