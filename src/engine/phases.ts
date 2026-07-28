import { evaluatePredicate, resolveValue } from "./expression.js";
import type { FlowDefinition, ForeachStep, IfStep, Scope, Step } from "./types.js";

/**
 * Tracks the flat phase index N and dynamically computes total M for
 * the `Phase N/M` progress display. A "phase" is a user-visible unit
 * of work: agent steps, script steps, foreach iterations (one per
 * surviving item), and skipped if-blocks (one [SKIP] line).
 *
 * read-file and loop steps are plumbing and produce no phase line.
 * Steps nested inside a foreach body share their parent's phase index.
 */
export class PhaseTracker {
  private readonly flow: FlowDefinition;
  private readonly ifOutcomes = new Map<IfStep, boolean>();
  private current = 0;

  constructor(flow: FlowDefinition) {
    this.flow = flow;
  }

  /** Advance to the next phase and return its 1-indexed number. */
  advance(): number {
    this.current++;
    return this.current;
  }

  /** Record whether an if-step was taken or skipped. */
  recordIfOutcome(step: IfStep, taken: boolean): void {
    this.ifOutcomes.set(step, taken);
  }

  /**
   * Compute the total number of phases given current scope.
   * Returns null when the total cannot yet be determined (e.g.
   * the foreach source array hasn't been resolved yet).
   */
  total(scope: Scope): number | null {
    return this.countSteps(this.flow.steps, scope);
  }

  /** Format the phase counter, e.g. "Phase 7/16" or "Phase 1/?". */
  formatCounter(scope: Scope): string {
    const t = this.total(scope);
    return `Phase ${this.current}/${t ?? "?"}`;
  }

  private countSteps(steps: Step[], scope: Scope): number | null {
    let total = 0;
    for (const step of steps) {
      const c = this.countStep(step, scope);
      if (c === null) return null;
      total += c;
    }
    return total;
  }

  private countStep(step: Step, scope: Scope): number | null {
    switch (step.type) {
      case "agent":
      case "script":
        return 1;

      case "foreach":
        return this.countForeach(step, scope);

      case "if":
        return this.countIf(step, scope);

      case "read-file":
      case "loop":
        return 0;

      default:
        return 0;
    }
  }

  private countForeach(step: ForeachStep, scope: Scope): number | null {
    let items: unknown;
    try {
      items = resolveValue(step.in, scope);
    } catch {
      return null;
    }
    if (!Array.isArray(items)) return null;

    if (!step.when) {
      return (items as unknown[]).length;
    }

    let count = 0;
    for (let i = 0; i < (items as unknown[]).length; i++) {
      const iterScope: Scope = { ...scope, [step.var]: (items as unknown[])[i] };
      try {
        if (evaluatePredicate(step.when, iterScope)) {
          count++;
        }
      } catch {
        return null;
      }
    }
    return count;
  }

  // Note: this method is only reached for `if` steps reachable via
  // top-level `countSteps` or recursion through `if.then` bodies —
  // never for `if` steps nested inside `foreach.do` or `loop.do`,
  // because `countForeach` counts items without recursing into the
  // body and `countStep` returns 0 for loops. The runner mirrors
  // this: it only emits [SKIP] and advances for top-level-equivalent
  // ifs (ctx.isTopLevel), so the count stays consistent.
  private countIf(step: IfStep, scope: Scope): number | null {
    const outcome = this.ifOutcomes.get(step);
    if (outcome === false) {
      return 1; // the [SKIP] line
    }
    if (outcome === true) {
      return this.countSteps(step.then, scope);
    }
    // Not yet evaluated — try to compute the if-taken branch count
    // as an optimistic estimate, but we can't know for sure
    try {
      const taken = evaluatePredicate(step.condition, scope);
      if (!taken) return 1;
      return this.countSteps(step.then, scope);
    } catch {
      return null;
    }
  }
}
