import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FlowDefinition } from "./types.js";

/**
 * Step addresses locate one execution of one leaf step inside a flow,
 * independent of what the flow is:
 *
 *   steps[7]@3/do[1]#2/then[0]
 *
 * `steps[i]`/`do[i]`/`then[i]` are positions in a step list, `@n` is the
 * index of the current item in a foreach's *unfiltered* source array, and
 * `#n` is the 1-based loop iteration. Two runs of the same flow definition
 * with the same scope produce the same addresses, which is what lets a
 * resumed run recognise the work an earlier attempt already finished.
 */
export function topLevelAddress(index: number): string {
  return `steps[${index}]`;
}

export function foreachChildAddress(
  parent: string,
  itemIndex: number,
  childIndex: number,
): string {
  return `${parent}@${itemIndex}/do[${childIndex}]`;
}

export function loopChildAddress(
  parent: string,
  iteration: number,
  childIndex: number,
): string {
  return `${parent}#${iteration}/do[${childIndex}]`;
}

export function ifChildAddress(parent: string, childIndex: number): string {
  return `${parent}/then[${childIndex}]`;
}

export interface StepRecord {
  addr: string;
  type: "agent" | "script" | "read-file";
  /** Scope variable the step assigned, when it has one. */
  set?: string;
  /** The assigned value, replayed into scope on resume. */
  value?: unknown;
  /** ISO timestamp of completion. */
  at: string;
}

/**
 * Append-only record of completed leaf steps, stored as one JSON object per
 * line in `<runDir>/steps.jsonl`.
 */
export interface RunJournal {
  has(addr: string): StepRecord | undefined;
  append(record: StepRecord): Promise<void>;
  /** Number of records loaded or appended so far. */
  size(): number;
}

export const JOURNAL_FILE = "steps.jsonl";

class FileJournal implements RunJournal {
  private readonly path: string;
  private readonly records = new Map<string, StepRecord>();

  constructor(runDir: string, existing: StepRecord[]) {
    this.path = resolve(runDir, JOURNAL_FILE);
    for (const rec of existing) this.records.set(rec.addr, rec);
  }

  has(addr: string): StepRecord | undefined {
    return this.records.get(addr);
  }

  async append(record: StepRecord): Promise<void> {
    const line = JSON.stringify(record);
    if (record.set !== undefined && JSON.stringify(record.value) === undefined) {
      throw new Error(
        `journal: value of '${record.set}' at ${record.addr} is not JSON-serialisable`,
      );
    }
    await mkdir(resolve(this.path, ".."), { recursive: true });
    await appendFile(this.path, line + "\n", "utf8");
    this.records.set(record.addr, record);
  }

  size(): number {
    return this.records.size;
  }
}

/** A journal for a fresh run: nothing is recorded yet. */
export function createJournal(runDir: string): RunJournal {
  return new FileJournal(runDir, []);
}

/**
 * Opens the journal of an earlier attempt. A trailing line that does not
 * parse is treated as a step that never completed — that is what a kill
 * mid-append leaves behind.
 */
export async function openJournal(runDir: string): Promise<RunJournal> {
  const path = resolve(runDir, JOURNAL_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new FileJournal(runDir, []);
    }
    throw err;
  }

  const lines = text.split("\n").filter((l) => l.length > 0);
  const records: StepRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]) as StepRecord;
      if (typeof parsed.addr !== "string") throw new Error("missing addr");
      records.push(parsed);
    } catch (err) {
      if (i === lines.length - 1) break;
      throw new Error(
        `journal: corrupt record at ${path}:${i + 1}`,
        { cause: err },
      );
    }
  }
  return new FileJournal(runDir, records);
}

/**
 * Identity of a flow definition for resume purposes. Hashing the parsed
 * structure rather than the YAML text means reformatting or comment edits
 * keep a run resumable, while any structural change does not.
 */
export function flowHash(flow: FlowDefinition): string {
  return createHash("sha256").update(JSON.stringify(flow)).digest("hex");
}
