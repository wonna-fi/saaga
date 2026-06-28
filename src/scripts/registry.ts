import { archiveQuickUpdate } from "./archive-quick-update.js";
import { collectQuickUpdates } from "./collect-quick-updates.js";
import { detectChanges } from "./detect-changes.js";
import { generateBaseline } from "./generate-baseline.js";
import { installRules } from "./install-rules.js";
import { parsePlan } from "./parse-plan.js";
import { removeQuickUpdates } from "./remove-quick-updates.js";

export interface ScriptContext {
  /** Working directory: the application being documented. */
  cwd: string;
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
  "collect-quick-updates": collectQuickUpdates as unknown as ScriptHandler,
  "remove-quick-updates": removeQuickUpdates as unknown as ScriptHandler,
  "install-rules": installRules as unknown as ScriptHandler,
};
