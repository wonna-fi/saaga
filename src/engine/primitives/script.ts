import {
  defaultScriptRegistry,
  type ScriptRegistry,
} from "../../scripts/registry.js";
import { interpolate } from "../expression.js";
import type { Scope, ScriptStep } from "../types.js";

export interface RunScriptDeps {
  cwd: string;
  scripts?: ScriptRegistry;
  /** Forwarded to the handler as `ctx.warn`; absent when there is no logger. */
  warn?: (message: string) => void;
}

export async function runScriptStep(
  step: ScriptStep,
  scope: Scope,
  deps: RunScriptDeps,
): Promise<void> {
  const registry = deps.scripts ?? defaultScriptRegistry;
  const handler = registry[step.name];
  if (!handler) {
    throw new Error(`Unknown script: ${step.name}`);
  }

  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(step.args)) {
    args[k] = interpolate(v, scope);
  }

  const result = await handler(args, { cwd: deps.cwd, warn: deps.warn });
  if (step.set) {
    scope[step.set] = result;
  }
}
