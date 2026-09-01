import { evaluatePredicate } from "../expression.js";
import type { LoopStep, Scope } from "../types.js";
import type { StepDispatcher } from "./foreach.js";

type Saved = { had: true; value: unknown } | { had: false };

function save(scope: Scope, key: string): Saved {
  return Object.prototype.hasOwnProperty.call(scope, key)
    ? { had: true, value: scope[key] }
    : { had: false };
}

function restore(scope: Scope, key: string, saved: Saved): void {
  if (saved.had) {
    scope[key] = saved.value;
  } else {
    delete scope[key];
  }
}

/**
 * Runs `step.do` repeatedly. Each iteration:
 *   1. Sets `${iteration}` to the current count (1-indexed).
 *   2. Executes every step in `do`.
 *   3. Evaluates `until`. If true, the loop exits.
 *
 * `${loop_max}` is bound to the cap for the whole body. A body step that has to
 * know it is running for the last time -- the verifier, whose FAIL on the final
 * round is never re-checked -- compares the two. Both are scoped to the body and
 * restored afterwards, so a nested loop shadows its parent's values rather than
 * overwriting them.
 *
 * Hard cap: the loop never runs more than `step.max` iterations.
 */
export async function runLoopStep(
  step: LoopStep,
  scope: Scope,
  dispatch: StepDispatcher,
): Promise<void> {
  const previousIteration = save(scope, "iteration");
  const previousMax = save(scope, "loop_max");

  try {
    scope.loop_max = step.max;
    for (let i = 1; i <= step.max; i++) {
      scope.iteration = i;
      for (let j = 0; j < step.do.length; j++) {
        await dispatch(step.do[j], scope, j, i);
      }
      if (evaluatePredicate(step.until, scope)) {
        break;
      }
    }
  } finally {
    restore(scope, "iteration", previousIteration);
    restore(scope, "loop_max", previousMax);
  }
}
