import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PromptContext {
  /** The slice/phase this render belongs to, when the step names one. */
  phase?: string;
  /** The verify/fix loop iteration, when the step runs inside a loop. */
  iteration?: string;
}

/**
 * Copies every rendered agent prompt into the run directory.
 *
 * The archived plan used to record everything the documentation writer saw,
 * because the plan carried the methodology. Now that the methodology lives in
 * the prompts, the plan alone no longer reconstructs a run — so the prompts
 * are archived alongside it.
 */
export interface PromptArchive {
  /**
   * Writes one rendered prompt to `<runDir>/prompts/`.
   *
   * `context` only makes the filename readable; uniqueness comes from an
   * internal counter.
   */
  record(
    promptName: string,
    context: PromptContext,
    prompt: string,
  ): Promise<void>;
}

/** Highest `NN-` prefix among archived prompts, or 0 when there are none. */
async function highestSequence(dir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let max = 0;
  for (const name of names) {
    const m = /^(\d+)-/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Filename-safe form of a var value (they can be paths or arbitrary text). */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Creates an archive rooted at `<runDir>/prompts/`, or `undefined` when the
 * flow has no run directory (engine tests run flows without one).
 */
export function createPromptArchive(
  runDir: string | undefined,
): PromptArchive | undefined {
  if (!runDir) return undefined;

  const dir = resolve(runDir, "prompts");
  let seq: number | undefined;

  return {
    async record(promptName, context, prompt) {
      // A monotonic counter is what guarantees uniqueness: `slice-doc`
      // renders once per phase and verify/fix once per loop iteration, and
      // the context labels below are only there to make the run readable.
      // It continues from whatever an earlier attempt of this run left, so
      // resuming never overwrites the prompts of the first attempt.
      if (seq === undefined) seq = await highestSequence(dir);
      seq += 1;
      const parts = [String(seq).padStart(2, "0"), slug(promptName)];
      if (context.phase) parts.push(`phase${slug(context.phase)}`);
      if (context.iteration) parts.push(`iter${slug(context.iteration)}`);

      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, `${parts.join("-")}.md`), prompt, "utf8");
    },
  };
}
