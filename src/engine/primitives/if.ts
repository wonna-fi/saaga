import { evaluatePredicate } from "../expression.js";
import type { IfStep, Scope } from "../types.js";
import type { StepDispatcher } from "./foreach.js";

/**
 * Executes the `then` body iff the `condition` predicate is true. There
 * is currently no `else` branch; flows that need one can chain a second
 * `if` with the negated predicate.
 */
export async function runIfStep(
  step: IfStep,
  scope: Scope,
  dispatch: StepDispatcher,
): Promise<void> {
  if (evaluatePredicate(step.condition, scope)) {
    for (const child of step.then) {
      await dispatch(child, scope);
    }
  }
}
