import { evaluatePredicate, resolveValue } from "../expression.js";
import type { ForeachStep, Scope, Step } from "../types.js";

/**
 * `runStep` is taken as a callback to avoid a circular import with
 * `runner.ts`. The runner injects its own dispatcher when invoking
 * `runForeachStep`.
 */
export type StepDispatcher = (step: Step, scope: Scope) => Promise<void>;

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
    for (const item of items) {
      scope[step.var] = item;
      if (step.when && !evaluatePredicate(step.when, scope)) {
        continue;
      }
      for (const child of step.do) {
        await dispatch(child, scope);
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
