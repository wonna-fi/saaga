import { describe, expect, test } from "vitest";

import { createCodexEventParser } from "../../src/agent/codex-agent.js";

const item = (value: Record<string, unknown>) => JSON.stringify({ type: "item.completed", item: value });

describe("Codex event parser", () => {
  test("reads usage from captured Codex exec JSONL without inventing cost or toolset", () => {
    const parser = createCodexEventParser();
    expect(parser.push('{"type":"thread.started","thread_id":"thread"}')).toEqual([]);
    expect(parser.push('{"type":"turn.completed","usage":{"input_tokens":46721,"cached_input_tokens":33024,"cache_write_input_tokens":0,"output_tokens":422,"reasoning_output_tokens":121}}')).toEqual([{
      kind: "usage", inputTokens: 46721, cacheReadTokens: 33024, cacheCreationTokens: 0, outputTokens: 422,
    }]);
  });

  test("reads the native stderr rejection emitted before a command gets a JSONL item", () => {
    expect(createCodexEventParser().push("2026-09-19T07:27:59.570546Z ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: Saaga policy: Command is outside Saaga's shell allowance. Command: sha256sum src/source.txt")).toEqual([{
      kind: "denial", tool: "shell", message: "Saaga policy: Command is outside Saaga's shell allowance", command: "sha256sum src/source.txt",
    }]);
  });

  test("reports a sandbox refusal with its command", () => {
    expect(createCodexEventParser().push(item({ type: "command_execution", command: "cat /outside/secret",
      exit_code: 1, status: "completed", aggregated_output: "cat: /outside/secret: Permission denied\n" }))).toEqual([{
      kind: "denial", tool: "shell", command: "cat /outside/secret", message: "cat: /outside/secret: Permission denied\n",
    }]);
  });

  test("reports a native patch refusal without inventing a file path", () => {
    expect(createCodexEventParser().push("2026-09-19T07:39:22.594411Z ERROR codex_core::tools::router: error=patch rejected: writing outside of the project; rejected by user approval settings")).toEqual([{
      kind: "denial", tool: "apply_patch", message: "patch rejected: writing outside of the project; rejected by user approval settings",
    }]);
  });

  test("reports a file denial only when a failed patch includes an explicit denial", () => {
    const change = { type: "file_change", status: "failed", changes: [{ path: "/app/src/a.ts", kind: "update" }] };
    expect(createCodexEventParser().push(item(change))).toEqual([]);
    expect(createCodexEventParser().push(item({ ...change, aggregated_output: "Permission denied" }))).toEqual([{
      kind: "denial", tool: "apply_patch", path: "/app/src/a.ts", message: "Permission denied",
    }]);
  });

  test.each([
    "", "progress", "{bad json", "null", "[]",
    item({ type: "agent_message", text: "Permission denied" }),
    item({ type: "agent_message", text: "ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: Saaga policy: blocked. Command: sha256sum file" }),
    item({ type: "command_execution", exit_code: 0, aggregated_output: "Permission denied" }),
    item({ type: "command_execution", exit_code: 1, aggregated_output: "No such file or directory" }),
    item({ type: "error", message: "Temporary API failure" }),
    '{"type":"item.completed","item":null}',
  ])("ignores unrelated or malformed output %s", line => {
    expect(createCodexEventParser().push(line)).toEqual([]);
  });

  test("ignores nonnumeric usage fields", () => {
    expect(createCodexEventParser().push('{"type":"turn.completed","usage":{"input_tokens":"100","output_tokens":null}}')).toEqual([{
      kind: "usage", inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, cacheCreationTokens: undefined,
    }]);
  });
});
