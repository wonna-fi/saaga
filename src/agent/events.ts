/**
 * Normalized agent events parsed from a backend's structured output.
 *
 * Every backend can be asked to emit newline-delimited JSON instead of prose.
 * The value of that is not that the text becomes stable — it is that the
 * denial is reported by the CLI's own code rather than narrated by the model.
 * Model narration varies between runs and is sometimes wrong about the cause:
 * copilot has been observed blaming "/etc requires root privileges" for what
 * was actually its own permission layer refusing the call.
 */

/** A tool call the backend refused on permission grounds. */
export interface DenialEvent {
  kind: "denial";
  /** Tool that was refused, in the backend's own naming. */
  tool: string;
  /** Absolute path the call targeted, where the backend reveals it. */
  path?: string;
  /** Command the call would have run, where the backend reveals it. */
  command?: string;
  /** Message emitted by the CLI, not by the model. */
  message: string;
}

/** The toolset a backend announced when the session opened. */
export interface SessionEvent {
  kind: "session";
  tools: string[];
}

export type AgentEvent = DenialEvent | SessionEvent;

export type AgentEventSink = (event: AgentEvent) => void;

/** Incrementally turns a backend's NDJSON output into normalized events. */
export interface EventParser {
  push(line: string): AgentEvent[];
}

/**
 * Reassemble whole lines from arbitrarily chunked stream data.
 */
export class LineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    if (!this.buffer) return [];
    const last = this.buffer;
    this.buffer = "";
    return [last];
  }
}

/** Parse a line as JSON, ignoring the non-JSON noise backends interleave. */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Drive a parser over a stream, forwarding every event to the sink.
 */
export async function consumeEvents(
  stream: AsyncIterable<string | Uint8Array>,
  parser: EventParser,
  sink: AgentEventSink,
): Promise<void> {
  const splitter = new LineSplitter();
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
    for (const line of splitter.push(text)) {
      for (const event of parser.push(line)) sink(event);
    }
  }
  for (const line of splitter.flush()) {
    for (const event of parser.push(line)) sink(event);
  }
}
