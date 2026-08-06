import type { ResultPromise } from "execa";
import { consumeEvents, type AgentEventSink, type EventParser } from "./events.js";

export interface EventConsumer {
  parser: EventParser;
  sink: AgentEventSink;
}

/**
 * Await a spawned agent process, forwarding parsed events when requested.
 *
 * The stream has to be drained concurrently with the process rather than
 * after it: a long transcript fills the pipe buffer and the child blocks on
 * write, which would deadlock a run that is only waiting for it to exit.
 */
export async function awaitProcess(
  proc: ResultPromise,
  events?: EventConsumer,
): Promise<number> {
  if (!events || !proc.stdout) {
    const result = await proc;
    return result.exitCode ?? 1;
  }

  const consumed = consumeEvents(proc.stdout, events.parser, events.sink);
  const [result] = await Promise.all([proc, consumed]);
  return result.exitCode ?? 1;
}
