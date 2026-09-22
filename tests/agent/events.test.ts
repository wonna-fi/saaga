import { describe, expect, test } from "vitest";
import { createClaudeEventParser } from "../../src/agent/claude-agent.js";
import { createCopilotEventParser } from "../../src/agent/copilot-agent.js";
import { createCursorEventParser } from "../../src/agent/cursor-agent.js";
import { LineSplitter } from "../../src/agent/events.js";
import { createKiroEventParser } from "../../src/agent/kiro-agent.js";

/** Feed lines through a parser and collect everything it emits. */
function drain(parser: { push(line: string): unknown[] }, lines: string[]): unknown[] {
  return lines.flatMap((line) => parser.push(line));
}

describe("LineSplitter", () => {
  test("reassembles lines split across chunks", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.flush()).toEqual(['{"c"']);
  });

  test("flush is empty once drained", () => {
    const s = new LineSplitter();
    s.push("one\n");
    expect(s.flush()).toEqual([]);
  });
});

describe("cursor event parser", () => {
  // Shape captured from cursor-agent --output-format stream-json.
  const denialLine = JSON.stringify({
    type: "tool_call",
    subtype: "completed",
    tool_call: {
      editToolCall: {
        result: {
          writePermissionDenied: {
            path: "",
            error:
              "Write permission denied: /app/src/index.ts: Blocked by permissions configuration",
            isReadonly: false,
          },
        },
      },
    },
  });

  test("detects a denial from the typed result key, not the message text", () => {
    const events = drain(createCursorEventParser(), [denialLine]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "edit",
        path: "/app/src/index.ts",
        message:
          "Write permission denied: /app/src/index.ts: Blocked by permissions configuration",
      },
    ]);
  });

  test("catches a rejected shell call", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        shellToolCall: {
          result: {
            rejected: {
              command: "mkdir -p /run/plans",
              workingDirectory: "/app",
              reason: "",
              isReadonly: false,
            },
          },
        },
      },
    });
    const events = drain(createCursorEventParser(), [line]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "shell",
        path: undefined,
        command: "mkdir -p /run/plans",
        message: "mkdir -p /run/plans",
      },
    ]);
  });

  test("catches a rejected edit call, falling back to args.path", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        editToolCall: {
          args: { path: "/app/plans/out.md" },
          result: { rejected: { path: "", reason: "" } },
        },
      },
    });
    const events = drain(createCursorEventParser(), [line]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tool: "edit", path: "/app/plans/out.md" });
  });

  test("catches a rejected delete call", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        deleteToolCall: {
          result: { rejected: { path: "", reason: "File deletion rejected" } },
        },
      },
    });
    const events = drain(createCursorEventParser(), [line]);
    expect(events).toEqual([
      { kind: "denial", tool: "delete", path: undefined, message: "File deletion rejected" },
    ]);
  });

  test("catches a read error with 'Permission denied'", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        readToolCall: {
          args: { path: "/home/node/.cursor/terminals" },
          result: { error: { errorMessage: "Permission denied" } },
        },
      },
    });
    const events = drain(createCursorEventParser(), [line]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "read",
        path: "/home/node/.cursor/terminals",
        message: "Permission denied",
      },
    ]);
  });

  test("ignores a read error that is not a permission denial", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        readToolCall: {
          args: { path: "/app/missing.ts" },
          result: { error: { errorMessage: "File not found" } },
        },
      },
    });
    expect(drain(createCursorEventParser(), [line])).toEqual([]);
  });

  test("ignores successful tool calls, started events, and non-JSON", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", cwd: "/app" }),
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        tool_call: { shellToolCall: { args: { command: "ls" } } },
      }),
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        tool_call: { editToolCall: { result: { success: {} } } },
      }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
      "not json at all",
      "",
    ];
    expect(drain(createCursorEventParser(), lines)).toEqual([]);
  });
});

describe("copilot event parser", () => {
  const requestLine = JSON.stringify({
    type: "assistant.message",
    data: {
      toolRequests: [
        {
          toolCallId: "call-1",
          name: "create",
          arguments: { path: "/etc/escape.txt", file_text: "x" },
        },
      ],
    },
  });
  const denialLine = JSON.stringify({
    type: "tool.execution_complete",
    data: {
      toolCallId: "call-1",
      success: false,
      error: {
        message: "Permission denied and could not request permission from user",
        code: "denied",
      },
    },
  });

  test("correlates the denial back to the originating call for the path", () => {
    const events = drain(createCopilotEventParser(), [requestLine, denialLine]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "create",
        path: "/etc/escape.txt",
        message: "Permission denied and could not request permission from user",
      },
    ]);
  });

  test("keeps the command of a denied shell request", () => {
    const shellRequest = JSON.stringify({
      type: "assistant.message",
      data: {
        toolRequests: [
          { toolCallId: "call-2", name: "bash", arguments: { command: "ls /etc" } },
        ],
      },
    });
    const shellDenial = JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolCallId: "call-2",
        success: false,
        error: { message: "Permission denied", code: "denied" },
      },
    });
    const events = drain(createCopilotEventParser(), [shellRequest, shellDenial]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "bash",
        path: undefined,
        command: "ls /etc",
        message: "Permission denied",
      },
    ]);
  });

  test("ignores tool failures that are not permission denials", () => {
    const failure = JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolCallId: "call-1",
        success: false,
        error: { message: "No such file or directory", code: "enoent" },
      },
    });
    expect(drain(createCopilotEventParser(), [requestLine, failure])).toEqual([]);
  });

  test("still reports a denial when the originating call was not seen", () => {
    const events = drain(createCopilotEventParser(), [denialLine]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "unknown",
        path: undefined,
        message: "Permission denied and could not request permission from user",
      },
    ]);
  });
});

describe("claude event parser", () => {
  const initLine = JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["Edit", "Glob", "Grep", "Read", "Write"],
  });
  const useLine = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Write",
          input: { file_path: "/app/AGENTS.md", content: "x" },
        },
      ],
    },
  });
  const resultLine = JSON.stringify({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          is_error: true,
          content:
            "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>",
        },
      ],
    },
  });

  test("reports the announced tool surface", () => {
    const events = drain(createClaudeEventParser(), [initLine]);
    expect(events).toEqual([
      { kind: "session", tools: ["Edit", "Glob", "Grep", "Read", "Write"] },
    ]);
  });

  test("pairs the error result with the tool_use to recover the path", () => {
    const events = drain(createClaudeEventParser(), [useLine, resultLine]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "Write",
        path: "/app/AGENTS.md",
        message: "File is in a directory that is denied by your permission settings.",
      },
    ]);
  });

  test("keeps the bash command, since the refusal reports no path", () => {
    const bashUseLine = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "Bash",
            input: { command: "git show ce1e4d6 --stat", description: "show the commit" },
          },
        ],
      },
    });
    const bashResultLine = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            is_error: true,
            content:
              "<tool_use_error>Permission to use Bash with command git show ce1e4d6 --stat has been denied.</tool_use_error>",
          },
        ],
      },
    });
    const events = drain(createClaudeEventParser(), [bashUseLine, bashResultLine]);
    expect(events).toEqual([
      {
        kind: "denial",
        tool: "Bash",
        path: undefined,
        command: "git show ce1e4d6 --stat",
        message: "Permission to use Bash with command git show ce1e4d6 --stat has been denied.",
      },
    ]);
  });

  test("ignores tool errors that are not permission refusals", () => {
    const otherError = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            is_error: true,
            content: "<tool_use_error>File does not exist.</tool_use_error>",
          },
        ],
      },
    });
    expect(drain(createClaudeEventParser(), [useLine, otherError])).toEqual([]);
  });

  test("reports usage totals from the terminal result message", () => {
    const resultMessage = JSON.stringify({
      type: "result",
      subtype: "success",
      num_turns: 7,
      duration_ms: 42_000,
      total_cost_usd: 0.1234,
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 500,
      },
    });
    expect(drain(createClaudeEventParser(), [resultMessage])).toEqual([
      {
        kind: "usage",
        turns: 7,
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 9000,
        cacheCreationTokens: 500,
        costUsd: 0.1234,
        durationMs: 42_000,
      },
    ]);
  });

  test("degrades missing or malformed usage fields to undefined", () => {
    const partial = JSON.stringify({
      type: "result",
      num_turns: "3",
      usage: { input_tokens: 10 },
    });
    expect(drain(createClaudeEventParser(), [partial])).toEqual([
      {
        kind: "usage",
        turns: undefined,
        inputTokens: 10,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
        costUsd: undefined,
        durationMs: undefined,
      },
    ]);

    const bare = JSON.stringify({ type: "result" });
    const events = drain(createClaudeEventParser(), [bare]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "usage" });
  });
});

describe("kiro event parser", () => {
  // Shapes captured from kiro-cli 2.22.0 `chat --v3 --output-format stream-json`.
  const update = (u: Record<string, unknown>): string =>
    JSON.stringify({ type: "sessionUpdate", data: { sessionId: "sess_1", update: u } });

  const writeCall = update({
    sessionUpdate: "tool_call",
    toolCallId: "tooluse_w",
    title: "Write File",
    kind: "edit",
    status: "in_progress",
    locations: [{ path: "/repo/src/blocked.txt" }],
    rawInput: { path: "/repo/src/blocked.txt", text: "NOPE" },
  });
  const writePending = update({
    sessionUpdate: "tool_call_update",
    toolCallId: "tooluse_w",
    status: "pending",
    locations: [{ path: "/repo/src/blocked.txt" }],
  });

  test("an unstated write refused headlessly is a denial", () => {
    const failed = update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tooluse_w",
      status: "failed",
      title: "Write File",
      locations: [{ path: "/repo/src/blocked.txt" }],
      rawOutput: { message: "The user rejected this tool call." },
    });
    expect(drain(createKiroEventParser(), [writeCall, writePending, failed])).toEqual([
      {
        kind: "denial",
        tool: "Write File",
        path: "/repo/src/blocked.txt",
        command: undefined,
        message: "The user rejected this tool call.",
      },
    ]);
  });

  test("an explicit deny rule is a denial, target recovered from the first record", () => {
    // For an append, the failing update has neither `locations` nor `kind`.
    const call = update({
      sessionUpdate: "tool_call",
      toolCallId: "tooluse_a",
      title: "Append to File",
      kind: "edit",
      locations: [{ path: "/repo/docs/secret.txt" }],
      rawInput: { path: "/repo/docs/secret.txt" },
    });
    const failed = update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tooluse_a",
      status: "failed",
      rawOutput: {
        message:
          'Tool call denied by user\'s permissions. Rule: deny fs_write matching "/repo/docs/secret.txt" Source: agent-profile.',
      },
    });
    const [event] = drain(createKiroEventParser(), [call, failed]) as any[];
    expect(event.tool).toBe("Append to File");
    expect(event.path).toBe("/repo/docs/secret.txt");
    expect(event.message).toMatch(/^Tool call denied by user's permissions\. Rule: deny fs_write/);
  });

  test("a refused shell command reports the command, from wrapped output", () => {
    const call = update({
      sessionUpdate: "tool_call",
      toolCallId: "run_command_tooluse_1",
      title: "Run Command",
      kind: "execute",
      rawInput: { command: "touch src/pwned.txt", cwd: "/repo" },
    });
    const failed = update({
      sessionUpdate: "tool_call_update",
      toolCallId: "run_command_tooluse_1",
      status: "failed",
      title: "Run Command",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "Output:\nTool call denied by user's permissions. Rule: deny shell matching \"*\" Source: agent-profile.\n\nExit Code: -1",
          },
        },
      ],
    });
    const [event] = drain(createKiroEventParser(), [call, failed]) as any[];
    expect(event).toMatchObject({ kind: "denial", tool: "Run Command", command: "touch src/pwned.txt" });
    expect(event.message).toBe(
      'Tool call denied by user\'s permissions. Rule: deny shell matching "*" Source: agent-profile.',
    );
  });

  test("an ordinary tool failure is not a denial", () => {
    const failed = update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tooluse_l",
      status: "failed",
      title: "List Directory",
      content: [
        {
          type: "content",
          content: { type: "text", text: "Caught error listing: ENOENT: no such file or directory, stat '/repo/.kiro'" },
        },
      ],
      rawOutput: { message: "Caught error listing: ENOENT: no such file or directory, stat '/repo/.kiro'" },
    });
    expect(drain(createKiroEventParser(), [failed])).toEqual([]);
  });

  test("a failed command whose output merely quotes the phrase is not a denial", () => {
    const call = update({
      sessionUpdate: "tool_call",
      toolCallId: "run_command_tooluse_2",
      title: "Run Command",
      kind: "execute",
      rawInput: { command: "grep -rn rejected docs/" },
    });
    const failed = update({
      sessionUpdate: "tool_call_update",
      toolCallId: "run_command_tooluse_2",
      status: "failed",
      title: "Run Command",
      rawOutput: {
        message: "Output:\ndocs/notes.md:3: kiro says The user rejected this tool call.\n\nExit Code: 2",
      },
    });
    expect(drain(createKiroEventParser(), [call, failed])).toEqual([]);
  });

  test("completed calls, run records and non-JSON noise yield nothing", () => {
    const lines = [
      JSON.stringify({ type: "runStarted", data: { payloadSchema: "acp", engine: "v3" } }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t",
        status: "completed",
        title: "Read File",
      }),
      update({
        sessionUpdate: "session_info_update",
        _meta: { kiro: { promptTurnSummaries: [{ unit: "credit", usage: 0.02 }] } },
      }),
      JSON.stringify({
        type: "runError",
        data: { stage: "prompt", message: "The model 'bogus' is not available." },
      }),
      JSON.stringify({
        type: "runError",
        data: { stage: "interrupted", message: "the run was ended by a signal" },
      }),
      JSON.stringify({ type: "runFinished", data: { status: "success", stopReason: "end_turn" } }),
      "[INFO] kas.server.starting",
    ];
    expect(drain(createKiroEventParser(), lines)).toEqual([]);
  });
});
