import type { Backend } from "../cli/backend.js";

/**
 * CLI flags Saaga passes during agent runs, keyed by backend.
 *
 * Sourced from each adapter's buildArgs / run() path. `--version` is
 * omitted — the `version` probe already covers it.
 */
export const REQUIRED_CLI_FLAGS: Record<Backend, readonly string[]> = {
  claude: [
    "--print",
    "--model",
    "--permission-mode",
    "--strict-mcp-config",
    "--verbose",
    "--output-format",
    "--settings",
    "--dangerously-skip-permissions",
  ],
  copilot: [
    "-p",
    "--model",
    "--no-ask-user",
    "--no-auto-update",
    "--allow-all-tools",
    "--available-tools",
    "--allow-tool",
    "--disallow-temp-dir",
    "--output-format",
    "--add-dir",
  ],
  cursor: ["--print", "--model", "--trust", "--force", "--output-format"],
  kiro: [
    "--no-interactive",
    "--v3",
    "--model",
    "--output-format",
    "--agent",
    "--trust-all-tools",
  ],
};

/**
 * Arguments placed before `--help` for CLIs whose run flags belong to a
 * subcommand. `kiro-cli --help` lists only subcommands, and
 * `kiro-cli chat --help` lists the flags Saaga passes.
 */
export const BACKEND_HELP_ARGS: Partial<Record<Backend, readonly string[]>> = {
  kiro: ["chat"],
};

/**
 * Return the flags from `required` that do not appear as tokens in `help`.
 *
 * Matching is token-aware so short flags like `-p` do not false-positive
 * against longer ones like `--print`.
 */
export function findMissingRequiredFlags(
  help: string,
  required: readonly string[],
): string[] {
  return required.filter((flag) => !helpMentionsFlag(help, flag));
}

function helpMentionsFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Terminators cover plain flags (`--model`), value forms (`--model=` /
  // `--model `), Commander optional-value syntax (`--flag[=tools...]`),
  // and quoted example usages (`--allow-tool='write'`).
  return new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s,=\\['"])`, "m").test(help);
}
