import { evaluatePredicate, resolveValue } from "../expression.js";
import type { ForeachStep, Scope, Step } from "../types.js";

/**
 * `runStep` is taken as a callback to avoid a circular import with
 * `runner.ts`. The runner injects its own dispatcher when invoking
 * `runForeachStep`.
 */
export type StepDispatcher = (
  step: Step,
  scope: Scope,
  /** Position of `step` in the enclosing `do`/`then` list. */
  childIndex: number,
  /**
   * For foreach: index of the current item in the unfiltered source array.
   * For loop: the 1-based iteration. Unused (0) for `if`.
   */
  iterIndex: number,
) => Promise<void>;

export async function runForeachStep(
  step: ForeachStep,
  scope: Scope,
  dispatch: StepDispatcher,
): Promise<void> {
  const items = resolveValue(step.in, scope);
  if (!Array.isArray(items)) {
    throw new Error(
      `'foreach.in' must resolve to an array, got: ${typeof items}`,
    );
  }

  const previous = Object.prototype.hasOwnProperty.call(scope, step.var)
    ? { had: true as const, value: scope[step.var] }
    : { had: false as const };

  try {
    for (let i = 0; i < items.length; i++) {
      scope[step.var] = items[i];
      if (step.when && !evaluatePredicate(step.when, scope)) {
        continue;
      }
      for (let j = 0; j < step.do.length; j++) {
        await dispatch(step.do[j], scope, j, i);
      }
    }
  } finally {
    if (previous.had) {
      scope[step.var] = previous.value;
    } else {
      delete scope[step.var];
    }
  }
}
