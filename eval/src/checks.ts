import type { CheckCtx, CheckResult } from "./types.js";

/**
 * Regex-based answer grading.
 *
 * Every predicate is pre-registered with its task and stays condition-blind:
 * checks only see the sandbox, never which condition produced it. Regexes
 * must not use the `g` flag (a sticky lastIndex would make `.test` stateful).
 */
export interface AnswerRules {
  /** All must match ANSWER.md for a pass. */
  must: RegExp[];
  /** None may match; used to catch known-stale claims. */
  mustNot?: RegExp[];
}

export function checkAnswer(rules: AnswerRules): (ctx: CheckCtx) => Promise<CheckResult> {
  return async (ctx) => {
    const answer = await ctx.readAnswer();
    if (answer.trim() === "") {
      return { pass: false, detail: "ANSWER.md missing or empty" };
    }
    for (const re of rules.must) {
      if (!re.test(answer)) {
        return { pass: false, detail: `expected match missing: ${re.toString()}` };
      }
    }
    for (const re of rules.mustNot ?? []) {
      if (re.test(answer)) {
        return { pass: false, detail: `forbidden match present: ${re.toString()}` };
      }
    }
    return { pass: true };
  };
}
