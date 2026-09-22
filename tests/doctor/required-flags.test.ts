import { describe, expect, test } from "vitest";
import { buildKiroArgs } from "../../src/agent/kiro-agent.js";
import {
  BACKEND_HELP_ARGS,
  findMissingRequiredFlags,
  REQUIRED_CLI_FLAGS,
} from "../../src/doctor/required-flags.js";

describe("findMissingRequiredFlags", () => {
  test("returns empty when every required flag is present", () => {
    const help = `
      Usage: claude [options]
        --print                 Non-interactive print mode
        --model <name>          Model to use
        --permission-mode <m>   Permission mode
        --strict-mcp-config     Strict MCP config
        --verbose               Verbose output
        --output-format <fmt>   Output format
        --settings <json>       Settings JSON
        --dangerously-skip-permissions  Skip permissions
    `;
    expect(findMissingRequiredFlags(help, REQUIRED_CLI_FLAGS.claude)).toEqual([]);
  });

  test("reports the specific flags that are missing", () => {
    const help = `
      --print
      --model
      --permission-mode
    `;
    expect(findMissingRequiredFlags(help, REQUIRED_CLI_FLAGS.claude)).toEqual([
      "--strict-mcp-config",
      "--verbose",
      "--output-format",
      "--settings",
      "--dangerously-skip-permissions",
    ]);
  });

  test("does not treat -p as a match for --print", () => {
    const help = `
      --print
      --model
      --trust
      --force
      --output-format
    `;
    // Cursor requires --print, not -p; this help has --print so it should pass.
    expect(findMissingRequiredFlags(help, REQUIRED_CLI_FLAGS.cursor)).toEqual([]);

    // Copilot requires -p; --print alone must not satisfy it.
    expect(findMissingRequiredFlags(help, ["-p"])).toEqual(["-p"]);
  });

  test("matches short flags that appear as tokens", () => {
    const help = `
      -p, --prompt <text>
      --model <name>
    `;
    expect(findMissingRequiredFlags(help, ["-p", "--model"])).toEqual([]);
  });

  test("does not match a flag that is only a prefix of a longer flag", () => {
    const help = `--model-low <name>`;
    expect(findMissingRequiredFlags(help, ["--model"])).toEqual(["--model"]);
  });

  test("matches Commander optional-value syntax", () => {
    const help = `  --available-tools[=tools...]          Only these tools`;
    expect(findMissingRequiredFlags(help, ["--available-tools"])).toEqual([]);
  });
});

describe("REQUIRED_CLI_FLAGS", () => {
  test("covers every backend", () => {
    expect(Object.keys(REQUIRED_CLI_FLAGS).sort()).toEqual([
      "claude",
      "copilot",
      "cursor",
      "kiro",
    ]);
  });

  test("lists at least one flag per backend", () => {
    for (const flags of Object.values(REQUIRED_CLI_FLAGS)) {
      expect(flags.length).toBeGreaterThan(0);
    }
  });

  test("kiro: covers every flag the adapter can emit", () => {
    const emitted = [
      ...buildKiroArgs("m", "p", { agentName: "saaga-x", streamJson: true }),
      ...buildKiroArgs("m", "p", { streamJson: false }),
    ].filter((arg) => arg.startsWith("-"));
    for (const flag of new Set(emitted)) {
      expect(REQUIRED_CLI_FLAGS.kiro).toContain(flag);
    }
  });
});

describe("BACKEND_HELP_ARGS", () => {
  test("reads kiro's flags from its chat subcommand, and only kiro's", () => {
    expect(BACKEND_HELP_ARGS.kiro).toEqual(["chat"]);
    expect(BACKEND_HELP_ARGS.claude).toBeUndefined();
    expect(BACKEND_HELP_ARGS.copilot).toBeUndefined();
    expect(BACKEND_HELP_ARGS.cursor).toBeUndefined();
  });
});
