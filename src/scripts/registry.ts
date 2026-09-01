import { archiveQuickUpdate } from "./archive-quick-update.js";
import { checkFormatVersion } from "./check-format-version.js";
import { checkPlanBudgetScript } from "./check-plan-budget.js";
import { cleanupQuickUpdateDir } from "./cleanup-quick-update-dir.js";
import { collectQuickUpdates } from "./collect-quick-updates.js";
import { detectChanges } from "./detect-changes.js";
import { ensureGitignore } from "./ensure-gitignore.js";
import { generateBaseline } from "./generate-baseline.js";
import { generateNavigation } from "./generate-navigation.js";
import { installRules } from "./install-rules.js";
import { parsePlan } from "./parse-plan.js";
import { removeQuickUpdates } from "./remove-quick-updates.js";
import { stampFormatVersion } from "./stamp-format-version.js";
import { validateDocs } from "./validate-docs.js";

export interface ScriptContext {
  /** Working directory: the application being documented. */
  cwd: string;
  /**
   * Emits a warning into the run output, when the caller supplied one.
   *
   * Optional because scripts are also invoked directly (from `src/cli.ts` and
   * from tests) with no logger in reach. A script that has something worth
   * saying but nothing worth failing over — `validate-docs` and its orphan
   * documents — uses this; a report nobody sees is not a warning.
   */
  warn?: (message: string) => void;
}

export type ScriptHandler = (
  args: Record<string, string>,
  ctx: ScriptContext,
) => Promise<unknown>;

export type ScriptRegistry = Record<string, ScriptHandler>;

/**
 * Built-in scripts available to every flow. New built-ins are registered
 * here; callers can also pass a custom `scripts` map via `RunFlowDeps` to
 * override or extend the registry (used by tests).
 */
export const defaultScriptRegistry: ScriptRegistry = {
  "parse-plan": parsePlan as unknown as ScriptHandler,
  "generate-baseline": generateBaseline as unknown as ScriptHandler,
  "detect-changes": detectChanges as unknown as ScriptHandler,
  "archive-quick-update": archiveQuickUpdate as unknown as ScriptHandler,
  "cleanup-quick-update-dir": cleanupQuickUpdateDir as unknown as ScriptHandler,
  "collect-quick-updates": collectQuickUpdates as unknown as ScriptHandler,
  "remove-quick-updates": removeQuickUpdates as unknown as ScriptHandler,
  "install-rules": installRules as unknown as ScriptHandler,
  "ensure-gitignore": ensureGitignore as unknown as ScriptHandler,
  "check-format-version": checkFormatVersion as unknown as ScriptHandler,
  "check-plan-budget": checkPlanBudgetScript as unknown as ScriptHandler,
  "stamp-format-version": stampFormatVersion as unknown as ScriptHandler,
  "generate-navigation": generateNavigation as unknown as ScriptHandler,
  "validate-docs": validateDocs as unknown as ScriptHandler,
};
