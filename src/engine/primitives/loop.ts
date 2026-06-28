import { evaluatePredicate } from "../expression.js";
import type { LoopStep, Scope } from "../types.js";
import type { StepDispatcher } from "./foreach.js";

/**
 * Runs `step.do` repeatedly. Each iteration:
 *   1. Sets `${iteration}` to the current count (1-indexed).
 *   2. Executes every step in `do`.
 *   3. Evaluates `until`. If true, the loop exits.
 *
 * Hard cap: the loop never runs more than `step.max` iterations.
 */
export async function runLoopStep(
  step: LoopStep,
  scope: Scope,
  dispatch: StepDispatcher,
): Promise<void> {
  const previous = Object.prototype.hasOwnProperty.call(scope, "iteration")
    ? { had: true as const, value: scope.iteration }
    : { had: false as const };

  try {
    for (let i = 1; i <= step.max; i++) {
      scope.iteration = i;
      for (const child of step.do) {
        await dispatch(child, scope);
      }
      if (evaluatePredicate(step.until, scope)) {
        break;
      }
    }
  } finally {
    if (previous.had) {
      scope.iteration = previous.value;
    } else {
      delete scope.iteration;
    }
  }
}
