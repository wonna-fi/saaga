import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import type { Agent } from "../agent/types.js";
import { Logger } from "../logger.js";
import { PROMPTS_DIR } from "../paths.js";
import type { ScriptRegistry } from "../scripts/registry.js";
import { renderPromptFile } from "../templates.js";
import { evaluatePredicate, interpolate, resolveValue } from "./expression.js";
import { runForeachStep } from "./primitives/foreach.js";
import { runIfStep } from "./primitives/if.js";
import { runLoopStep } from "./primitives/loop.js";
import { runReadFileStep } from "./primitives/read-file.js";
import { runScriptStep } from "./primitives/script.js";
import type {
  AgentStep,
  FlowDefinition,
  ForeachStep,
  LoopStep,
  Scope,
  Step,
} from "./types.js";

export interface RunFlowDeps {
  /** Agent backend used for `agent` steps. */
  agent: Agent;
  /** Working directory passed to `Agent.run` (the app being documented). */
  cwd: string;
  /** Optional override for the built-in script registry (used by tests). */
  scripts?: ScriptRegistry;
  /**
   * Logger used to narrate flow progress (one line per step entry and
   * exit, with timing). Defaults to a silent logger so library callers
   * and tests don't get noise unless they ask for it; the CLI always
   * supplies a real one writing to stderr.
   */
  logger?: Logger;
}

export async function runFlow(
  flow: FlowDefinition,
  initialScope: Scope,
  deps: RunFlowDeps,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const effectiveDeps: RunFlowDeps = { ...deps, logger };
  const scope: Scope = { ...initialScope };

  const t0 = Date.now();
  logger.info(`flow ${flow.name}: starting (${flow.steps.length} steps)`);
  try {
    for (let i = 0; i < flow.steps.length; i++) {
      await runStep(flow.steps[i], scope, effectiveDeps, {
        index: i + 1,
        total: flow.steps.length,
      });
    }
    logger.info(`flow ${flow.name}: done (${formatDuration(Date.now() - t0)})`);
  } catch (err) {
    logger.error(
      `flow ${flow.name}: failed after ${formatDuration(Date.now() - t0)}`,
    );
    throw err;
  }
}

interface StepPosition {
  /** 1-indexed position within the parent step list. */
  index: number;
  /** Total number of sibling steps at the current depth. */
  total: number;
}

async function runStep(
  step: Step,
  scope: Scope,
  deps: RunFlowDeps,
  pos?: StepPosition,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const childLogger = logger.child();
  const childDeps: RunFlowDeps = { ...deps, logger: childLogger };

  const prefix = pos ? `step ${pos.index}/${pos.total}` : "step";
  const t0 = Date.now();

  switch (step.type) {
    case "agent": {
      logger.info(
        `${prefix}: agent ${step.prompt}${describeAgentContext(step, scope)}`,
      );
      await runAgentStep(step, scope, deps);
      logger.info(
        `${prefix}: agent ${step.prompt} done (${formatDuration(Date.now() - t0)})`,
      );
      return;
    }
    case "script": {
      logger.info(`${prefix}: script ${step.name}`);
      await runScriptStep(step, scope, {
        cwd: deps.cwd,
        scripts: deps.scripts,
      });
      logger.info(
        `${prefix}: script ${step.name} done (${formatDuration(Date.now() - t0)})`,
      );
      return;
    }
    case "foreach": {
      const items = resolveValue(step.in, scope);
      const count = Array.isArray(items) ? items.length : 0;
      logger.info(
        `${prefix}: foreach ${step.var} in ${step.in} (${count} item${count === 1 ? "" : "s"})`,
      );
      await runForeachWithLogging(step, scope, childLogger, deps);
      logger.info(
        `${prefix}: foreach ${step.var} done (${formatDuration(Date.now() - t0)})`,
      );
      return;
    }
    case "loop": {
      logger.info(`${prefix}: loop (max=${step.max}, until=${step.until})`);
      await runLoopWithLogging(step, scope, childLogger, childDeps);
      logger.info(`${prefix}: loop done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "read-file": {
      const path = interpolate(step.path, scope);
      logger.info(`${prefix}: read-file ${path} -> \${${step.set}}`);
      await runReadFileStep(step, scope);
      const bound = scope[step.set];
      logger.info(
        `${prefix}: read-file done (${formatDuration(Date.now() - t0)}, ${summarizeValue(bound)})`,
      );
      return;
    }
    case "if": {
      const taken = evaluatePredicate(step.condition, scope);
      logger.info(
        `${prefix}: if ${step.condition} -> ${taken ? "true" : "false (skip)"}`,
      );
      if (taken) {
        await runIfStep(step, scope, (child, childScope) =>
          runStep(child, childScope, childDeps, indexIn(step.then, child)),
        );
      }
      return;
    }
    default:
      throw new Error(`Unsupported step type: '${(step as Step).type}'`);
  }
}

/**
 * Logs iteration banners as items are consumed. Child step indices are
 * taken relative to `step.do`.
 */
async function runForeachWithLogging(
  step: ForeachStep,
  scope: Scope,
  iterationLogger: Logger,
  deps: RunFlowDeps,
): Promise<void> {
  const items = resolveValue(step.in, scope);
  if (!Array.isArray(items)) {
    throw new Error(
      `'foreach.in' must resolve to an array, got: ${typeof items}`,
    );
  }
  const total = items.length;
  let iter = 0;
  const bodyLogger = iterationLogger.child();
  const bodyDeps: RunFlowDeps = { ...deps, logger: bodyLogger };

  await runForeachStep(
    step,
    scope,
    async (child, iterScope) => {
      if (step.do.length > 0 && child === step.do[0]) {
        iter++;
        iterationLogger.info(
          `iteration ${iter}/${total}${describeIterItem(step.var, iterScope)}`,
        );
      }
      await runStep(child, iterScope, bodyDeps, indexIn(step.do, child));
    },
  );
}

/**
 * Logs iteration banners for a `loop` body. Child step indices are taken
 * relative to `step.do`.
 */
async function runLoopWithLogging(
  step: LoopStep,
  scope: Scope,
  iterationLogger: Logger,
  childDeps: RunFlowDeps,
): Promise<void> {
  const bodyLogger = iterationLogger.child();
  const bodyDeps: RunFlowDeps = { ...childDeps, logger: bodyLogger };

  await runLoopStep(step, scope, async (child, iterScope) => {
    if (step.do.length > 0 && child === step.do[0]) {
      iterationLogger.info(`iteration ${iterScope.iteration ?? "?"}`);
    }
    await runStep(child, iterScope, bodyDeps, indexIn(step.do, child));
  });
}

function indexIn(steps: Step[], target: Step): StepPosition | undefined {
  const idx = steps.indexOf(target);
  if (idx < 0) return undefined;
  return { index: idx + 1, total: steps.length };
}

async function runAgentStep(
  step: AgentStep,
  scope: Scope,
  deps: RunFlowDeps,
): Promise<void> {
  const promptPath = resolve(PROMPTS_DIR, `${step.prompt}.md`);

  const renderedVars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(step.vars ?? {})) {
    renderedVars[key] = interpolate(raw, scope);
  }

  const prompt = await renderPromptFile(promptPath, renderedVars);

  const result = await deps.agent.run(prompt, { cwd: deps.cwd });
  if (result.exitCode !== 0) {
    throw new AgentStepFailedError(step.prompt, result.exitCode);
  }

  if (step.expect_file) {
    const expectedPath = interpolate(step.expect_file, scope);
    await assertFileExists(expectedPath, step.prompt);
  }
}

async function assertFileExists(
  path: string,
  promptName: string,
): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new ExpectFileMissingError(path, promptName);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ExpectFileMissingError(path, promptName);
    }
    throw err;
  }
}

/**
 * Surfaces the few `vars:` entries that are useful to see at a glance
 * when an `agent` step starts (phase number, iteration counter). Anything
 * else stays out of the log to avoid drowning useful signal.
 */
function describeAgentContext(step: AgentStep, scope: Scope): string {
  const vars = step.vars ?? {};
  const interesting = ["phase_number", "phase.number", "iteration"];
  const parts: string[] = [];
  for (const key of interesting) {
    const raw = vars[key];
    if (raw === undefined) continue;
    parts.push(`${key.replace(".", "_")}=${interpolate(raw, scope)}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function describeIterItem(varName: string, scope: Scope): string {
  const value = scope[varName];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const num = obj.number;
    const title = obj.title;
    const numPart = num !== undefined ? `${varName}.number=${num}` : "";
    const titlePart =
      typeof title === "string"
        ? `${varName}.title=${JSON.stringify(title)}`
        : "";
    const joined = [numPart, titlePart].filter((s) => s.length > 0).join(", ");
    if (joined.length > 0) return ` (${joined})`;
  }
  if (typeof value === "string" || typeof value === "number") {
    return ` (${varName}=${value})`;
  }
  return "";
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") {
    const oneLine = value.replace(/\n/g, "\\n");
    const trimmed =
      oneLine.length > 40 ? `${oneLine.slice(0, 37)}...` : oneLine;
    return `${value.length} chars: "${trimmed}"`;
  }
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (value === null) return "null";
  return typeof value;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

let _silentLogger: Logger | null = null;
function silentLogger(): Logger {
  if (_silentLogger) return _silentLogger;
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  _silentLogger = new Logger({ stream: sink });
  return _silentLogger;
}

export class ExpectFileMissingError extends Error {
  readonly path: string;
  readonly promptName: string;

  constructor(path: string, promptName: string) {
    super(
      `Agent step '${promptName}' did not produce expect_file: ${path}`,
    );
    this.name = "ExpectFileMissingError";
    this.path = path;
    this.promptName = promptName;
  }
}

export class AgentStepFailedError extends Error {
  readonly promptName: string;
  readonly exitCode: number;

  constructor(promptName: string, exitCode: number) {
    super(`Agent step '${promptName}' exited with code ${exitCode}`);
    this.name = "AgentStepFailedError";
    this.promptName = promptName;
    this.exitCode = exitCode;
  }
}
