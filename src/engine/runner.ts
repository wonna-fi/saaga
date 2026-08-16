import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { PermissionAuditor } from "../agent/audit.js";
import type { AgentPermissions } from "../agent/permissions.js";
import type { Agent } from "../agent/types.js";
import { Logger, silentLogger } from "../logger.js";
import { formatDuration } from "../output.js";
import { PROMPTS_DIR } from "../paths.js";
import type { ScriptRegistry } from "../scripts/registry.js";
import { appendSaagaRules } from "../saaga-rules.js";
import { renderPromptFile } from "../templates.js";
import { evaluatePredicate, interpolate, resolveValue } from "./expression.js";
import { PhaseTracker } from "./phases.js";
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
  ScriptStep,
  Scope,
  Step,
} from "./types.js";

export interface RunFlowDeps {
  agent: Agent;
  cwd: string;
  scripts?: ScriptRegistry;
  logger?: Logger;
  /** Absolute path to the run log file for agent output capture. */
  logFile?: string;
  /** Mirror agent output to terminal (--verbose). */
  verbose?: boolean;
  /** Permission profile for agent steps. Absent means unrestricted. */
  permissions?: AgentPermissions;
  /**
   * Collects and classifies permission denials across the run.
   *
   * Its presence switches agent steps to structured output, so the run log
   * receives JSON rather than prose.
   */
  auditor?: PermissionAuditor;
  /** Pre-loaded `.saagarules` content snapshot, appended to every agent prompt. */
  saagaRules?: string;
}

export async function runFlow(
  flow: FlowDefinition,
  initialScope: Scope,
  deps: RunFlowDeps,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const effectiveDeps: RunFlowDeps = { ...deps, logger };
  const scope: Scope = { ...initialScope };
  const tracker = new PhaseTracker(flow);

  const t0 = Date.now();
  logger.detail(`flow ${flow.name}: starting (${flow.steps.length} steps)`);
  try {
    for (let i = 0; i < flow.steps.length; i++) {
      await runStep(flow.steps[i], scope, effectiveDeps, tracker, {
        isTopLevel: true,
        insideForeach: false,
      });
    }
    const elapsed = Date.now() - t0;
    const total = tracker.total(scope);
    const totalStr = total != null ? `${total} phases` : "done";
    logger.phaseImmediate(
      `saaga ${flow.name}: ${totalStr} in ${formatDuration(elapsed)}`,
      "DONE",
    );
  } catch (err) {
    const elapsed = Date.now() - t0;
    const total = tracker.total(scope);
    const summary = total != null
      ? `failed at phase ${tracker.formatCounter(scope)}`
      : "failed";
    logger.phaseImmediate(
      `saaga ${flow.name}: ${summary} after ${formatDuration(elapsed)}`,
      "FAIL",
    );
    throw err;
  }
}

interface StepContext {
  isTopLevel: boolean;
  /** When inside a foreach, the phase counter has already been advanced. */
  insideForeach: boolean;
  /** When inside a loop, the current iteration (1-indexed). */
  loopIteration?: number;
  /** When inside a loop, the max iterations. */
  loopMax?: number;
}

async function runStep(
  step: Step,
  scope: Scope,
  deps: RunFlowDeps,
  tracker: PhaseTracker,
  ctx: StepContext,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const t0 = Date.now();

  switch (step.type) {
    case "agent": {
      const label = resolveLabel(step, scope);
      const iterSuffix = formatIterSuffix(ctx);
      const shouldEmit = ctx.isTopLevel || ctx.insideForeach;
      if (shouldEmit && !ctx.insideForeach) {
        tracker.advance();
      }
      if (shouldEmit) {
        const counter = tracker.formatCounter(scope);
        const lineText = buildPhaseLine(counter, label, iterSuffix);
        logger.phaseBegin(lineText);
      }
      logger.detail(`agent ${step.prompt}${describeAgentContext(step, scope)}`);
      const logOffset = logger.logFileSize();
      try {
        await runAgentStep(step, scope, deps);
      } catch (err) {
        const elapsed = Date.now() - t0;
        if (shouldEmit) logger.phaseEnd("FAIL", elapsed);
        printFailureTail(logger, deps, logOffset);
        throw err;
      }
      if (shouldEmit) logger.phaseEnd("DONE", Date.now() - t0);
      return;
    }
    case "script": {
      const label = resolveLabel(step, scope);
      const iterSuffix = formatIterSuffix(ctx);
      const shouldEmit = ctx.isTopLevel || ctx.insideForeach;
      if (shouldEmit && !ctx.insideForeach) {
        tracker.advance();
      }
      if (shouldEmit) {
        const counter = tracker.formatCounter(scope);
        const lineText = buildPhaseLine(counter, label, iterSuffix);
        logger.phaseBegin(lineText);
      }
      logger.detail(`script ${step.name}`);
      try {
        await runScriptStep(step, scope, {
          cwd: deps.cwd,
          scripts: deps.scripts,
        });
      } catch (err) {
        const elapsed = Date.now() - t0;
        if (shouldEmit) logger.phaseEnd("FAIL", elapsed);
        throw err;
      }
      if (shouldEmit) logger.phaseEnd("DONE", Date.now() - t0);
      return;
    }
    case "foreach": {
      const items = resolveValue(step.in, scope);
      const count = Array.isArray(items) ? items.length : 0;
      logger.detail(`foreach ${step.var} in ${step.in} (${count} item${count === 1 ? "" : "s"})`);
      await runForeachWithPhases(step, scope, deps, tracker);
      logger.detail(`foreach ${step.var} done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "loop": {
      logger.detail(`loop (max=${step.max}, until=${step.until})`);
      await runLoopWithPhases(step, scope, deps, tracker, ctx);
      logger.detail(`loop done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "read-file": {
      const path = interpolate(step.path, scope);
      logger.detail(`read-file ${path} -> \${${step.set}}`);
      await runReadFileStep(step, scope);
      logger.detail(`read-file done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "if": {
      const taken = evaluatePredicate(step.condition, scope);
      tracker.recordIfOutcome(step, taken);
      logger.detail(`if ${step.condition} -> ${taken ? "true" : "false (skip)"}`);
      if (taken) {
        await runIfStep(step, scope, (child, childScope) =>
          runStep(child, childScope, deps, tracker, ctx),
        );
      } else if (ctx.isTopLevel) {
        tracker.advance();
        const counter = tracker.formatCounter(scope);
        const label = step.label ?? "conditional";
        const skipReason = step.skip_label ? ` (${interpolate(step.skip_label, scope)})` : "";
        const lineText = `${counter}: ${label}${skipReason}`;
        logger.phaseImmediate(lineText, "SKIP");
      }
      return;
    }
    default:
      throw new Error(`Unsupported step type: '${(step as Step).type}'`);
  }
}

async function runForeachWithPhases(
  step: ForeachStep,
  scope: Scope,
  deps: RunFlowDeps,
  tracker: PhaseTracker,
): Promise<void> {
  await runForeachStep(
    step,
    scope,
    async (child, iterScope) => {
      const isFirstInBody = step.do.length > 0 && child === step.do[0];
      if (isFirstInBody) {
        tracker.advance();
      }
      await runStep(child, iterScope, deps, tracker, {
        isTopLevel: false,
        insideForeach: true,
      });
    },
  );
}

async function runLoopWithPhases(
  step: LoopStep,
  scope: Scope,
  deps: RunFlowDeps,
  tracker: PhaseTracker,
  parentCtx: StepContext,
): Promise<void> {
  await runLoopStep(step, scope, async (child, iterScope) => {
    const iteration = typeof iterScope.iteration === "number" ? iterScope.iteration : undefined;
    await runStep(child, iterScope, deps, tracker, {
      isTopLevel: false,
      insideForeach: parentCtx.insideForeach,
      loopIteration: iteration,
      loopMax: step.max,
    });
  });
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

  const prompt = appendSaagaRules(
    await renderPromptFile(promptPath, renderedVars),
    deps.saagaRules,
  );

  const runDir = typeof scope.run_dir === "string" ? scope.run_dir : undefined;
  const writeRoots = deps.permissions?.writeRoots ?? [];
  const safeDirs = [...(runDir ? [runDir] : []), ...writeRoots];

  if (safeDirs.length > 0) {
    const dirsToEnsure = new Set<string>();
    for (const val of Object.values(renderedVars)) {
      if (safeDirs.some((root) => val.startsWith(root + sep))) {
        dirsToEnsure.add(dirname(val));
      }
    }
    if (step.expect_file) {
      const ef = interpolate(step.expect_file, scope);
      if (safeDirs.some((root) => ef.startsWith(root + sep))) {
        dirsToEnsure.add(dirname(ef));
      }
    }
    for (const dir of dirsToEnsure) {
      await mkdir(dir, { recursive: true });
    }
  }

  const additionalDirs =
    typeof scope.run_dir === "string" ? [scope.run_dir] : undefined;
  const auditor = deps.auditor;
  const result = await deps.agent.run(prompt, {
    cwd: deps.cwd,
    additionalDirs,
    permissions: deps.permissions,
    logFile: deps.logFile,
    echo: deps.verbose,
    onEvent: auditor ? (event) => auditor.record(event) : undefined,
  });
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

function resolveLabel(step: AgentStep | ScriptStep, scope: Scope): string {
  if (step.label) {
    try {
      return interpolate(step.label, scope);
    } catch {
      return step.label;
    }
  }
  const name = step.type === "agent" ? step.prompt : step.name;
  return name.replace(/-/g, " ");
}

function buildPhaseLine(counter: string, label: string, iterSuffix: string): string {
  return `${counter}: ${label}${iterSuffix}`;
}

function formatIterSuffix(ctx: StepContext): string {
  if (ctx.loopIteration != null && ctx.loopMax != null) {
    return ` (iteration ${ctx.loopIteration}/${ctx.loopMax})`;
  }
  return "";
}

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

function printFailureTail(logger: Logger, deps: RunFlowDeps, fromByte: number): void {
  if (!deps.logFile) return;
  const tail = logger.tailLog(fromByte, 20);
  if (tail) {
    logger.error(`Agent output (last lines from ${deps.logFile}):`);
    for (const line of tail.split("\n").slice(-20)) {
      logger.error(`  ${line}`);
    }
  } else {
    logger.error(`See full log: ${deps.logFile}`);
  }
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
