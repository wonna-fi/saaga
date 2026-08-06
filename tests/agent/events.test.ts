import { describe, expect, test } from "vitest";
import { createClaudeEventParser } from "../../src/agent/claude-agent.js";
import { createCopilotEventParser } from "../../src/agent/copilot-agent.js";
import { createCursorEventParser } from "../../src/agent/cursor-agent.js";
import { LineSplitter } from "../../src/agent/events.js";

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
});
