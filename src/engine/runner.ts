import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { PermissionAuditor } from "../agent/audit.js";
import type { AgentPermissions } from "../agent/permissions.js";
import type { Agent } from "../agent/types.js";
import { Logger, silentLogger } from "../logger.js";
import { DEFAULT_MODEL_KEY } from "../model-keys.js";
import { formatDuration } from "../output.js";
import { PROMPTS_DIR } from "../paths.js";
import type { ScriptRegistry } from "../scripts/registry.js";
import { appendSaagaRules } from "../saaga-rules.js";
import { renderPromptFile } from "../templates.js";
import { evaluatePredicate, interpolate, resolveValue } from "./expression.js";
import {
  foreachChildAddress,
  ifChildAddress,
  loopChildAddress,
  topLevelAddress,
  type RunJournal,
} from "./journal.js";
import { PhaseTracker } from "./phases.js";
import { createPromptArchive, type PromptArchive } from "./prompt-archive.js";
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
  ReadFileStep,
  ScriptStep,
  Scope,
  Step,
} from "./types.js";

/**
 * The model an agent step should run on, or `undefined` to let the backend
 * use the model it was constructed with.
 *
 * The `typeof` guard is load-bearing, for the same reason it is in
 * `resolveModel()`: `noUncheckedIndexedAccess` is off, and inherited names
 * like `constructor` and `toString` satisfy the model-key pattern, so an
 * unguarded lookup can hand a function to the backend's argv.
 */
function stepModel(step: AgentStep, deps: RunFlowDeps): string | undefined {
  const model = deps.models?.[step.model ?? DEFAULT_MODEL_KEY];
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

export interface RunFlowDeps {
  agent: Agent;
  /**
   * Resolved model key -> model name, covering every key the flow's agent
   * steps ask for. Absent means each step uses the model the agent was
   * constructed with, which is what tests injecting an agent directly get.
   */
  models?: Record<string, string>;
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
  /**
   * Archives each rendered prompt into the run directory. Set up by
   * `runFlow()` from the flow's `run_dir`; absent when there is none.
   */
  promptArchive?: PromptArchive;
  /**
   * Completed-step journal. Steps already recorded are replayed (their
   * scope effect re-applied) instead of executed; every leaf step that
   * completes is recorded. Absent means no journaling (engine tests).
   */
  journal?: RunJournal;
  /**
   * Cooperative cancellation. Checked before every step and after every
   * agent call; an abort surfaces as `RunAbortedError`, never as a step
   * failure, so the CLI can tell "the user stopped this" from "it broke".
   */
  signal?: AbortSignal;
  /**
   * Appended to the prompt of the first agent step actually executed by a
   * resumed run — the step an earlier attempt was in the middle of — so the
   * agent knows partial output may already exist.
   */
  resumeNote?: string;
}

export async function runFlow(
  flow: FlowDefinition,
  initialScope: Scope,
  deps: RunFlowDeps,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const runDir =
    typeof initialScope.run_dir === "string" ? initialScope.run_dir : undefined;
  const effectiveDeps: RunFlowDeps = {
    ...deps,
    logger,
    promptArchive: deps.promptArchive ?? createPromptArchive(runDir),
  };
  const scope: Scope = { ...initialScope };
  const tracker = new PhaseTracker(flow);
  const run: RunState = {
    replayed: 0,
    resumeNote: deps.resumeNote,
  };

  const t0 = Date.now();
  const resuming = (deps.journal?.size() ?? 0) > 0;
  logger.detail(
    `flow ${flow.name}: ${resuming ? "resuming" : "starting"} (${flow.steps.length} steps)`,
  );
  try {
    for (let i = 0; i < flow.steps.length; i++) {
      await runStep(flow.steps[i], scope, effectiveDeps, tracker, {
        isTopLevel: true,
        insideForeach: false,
        addr: topLevelAddress(i),
      }, run);
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
    const verb = err instanceof RunAbortedError ? "interrupted" : "failed";
    const summary = total != null
      ? `${verb} at phase ${tracker.formatCounter(scope)}`
      : verb;
    logger.phaseImmediate(
      `saaga ${flow.name}: ${summary} after ${formatDuration(elapsed)}`,
      "FAIL",
    );
    throw err;
  }
}

/** Mutable per-run bookkeeping shared by every `runStep` call. */
interface RunState {
  /** Leaf steps skipped because the journal already had them. */
  replayed: number;
  /** Pending resume note; consumed by the first executed agent step. */
  resumeNote?: string;
}

interface StepContext {
  /** Journal address of this step; see `journal.ts`. */
  addr: string;
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
  run: RunState,
): Promise<void> {
  const logger = deps.logger ?? silentLogger();
  const t0 = Date.now();

  // A stop requested during a script or between steps lands here: the
  // finished work is journaled, nothing further starts.
  if (deps.signal?.aborted) {
    throw new RunAbortedError(ctx.addr);
  }

  switch (step.type) {
    case "agent": {
      const label = resolveLabel(step, scope);
      const iterSuffix = formatIterSuffix(ctx);
      const shouldEmit = ctx.isTopLevel || ctx.insideForeach;
      if (shouldEmit && !ctx.insideForeach) {
        tracker.advance();
      }
      const phaseLine = () =>
        buildPhaseLine(tracker.formatCounter(scope), label, iterSuffix);
      if (replayIfJournaled(step, scope, deps, ctx, run, shouldEmit ? phaseLine : undefined)) {
        return;
      }
      if (shouldEmit) {
        logger.phaseBegin(phaseLine());
      }
      const model = stepModel(step, deps);
      logger.detail(
        `agent ${step.prompt}${describeAgentContext(step, scope)}` +
          (model ? ` [${model}]` : ""),
      );
      const logOffset = logger.logFileSize();
      try {
        await runAgentStep(step, scope, deps, run);
      } catch (err) {
        const elapsed = Date.now() - t0;
        if (shouldEmit) logger.phaseEnd("FAIL", elapsed);
        if (!(err instanceof RunAbortedError)) {
          printFailureTail(logger, deps, logOffset);
        }
        throw err;
      }
      await deps.journal?.append({
        addr: ctx.addr,
        type: "agent",
        at: new Date().toISOString(),
      });
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
      const phaseLine = () =>
        buildPhaseLine(tracker.formatCounter(scope), label, iterSuffix);
      if (replayIfJournaled(step, scope, deps, ctx, run, shouldEmit ? phaseLine : undefined)) {
        return;
      }
      if (shouldEmit) {
        logger.phaseBegin(phaseLine());
      }
      logger.detail(`script ${step.name}`);
      try {
        await runScriptStep(step, scope, {
          cwd: deps.cwd,
          scripts: deps.scripts,
          warn: (message) => logger.warn(message),
        });
      } catch (err) {
        const elapsed = Date.now() - t0;
        if (shouldEmit) logger.phaseEnd("FAIL", elapsed);
        throw err;
      }
      await deps.journal?.append({
        addr: ctx.addr,
        type: "script",
        ...(step.set ? { set: step.set, value: scope[step.set] } : {}),
        at: new Date().toISOString(),
      });
      if (shouldEmit) logger.phaseEnd("DONE", Date.now() - t0);
      return;
    }
    case "foreach": {
      const items = resolveValue(step.in, scope);
      const count = Array.isArray(items) ? items.length : 0;
      logger.detail(`foreach ${step.var} in ${step.in} (${count} item${count === 1 ? "" : "s"})`);
      await runForeachWithPhases(step, scope, deps, tracker, ctx, run);
      logger.detail(`foreach ${step.var} done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "loop": {
      logger.detail(`loop (max=${step.max}, until=${step.until})`);
      await runLoopWithPhases(step, scope, deps, tracker, ctx, run);
      logger.detail(`loop done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "read-file": {
      if (replayIfJournaled(step, scope, deps, ctx, run, undefined)) {
        return;
      }
      const path = interpolate(step.path, scope);
      logger.detail(`read-file ${path} -> \${${step.set}}`);
      await runReadFileStep(step, scope);
      await deps.journal?.append({
        addr: ctx.addr,
        type: "read-file",
        set: step.set,
        value: scope[step.set],
        at: new Date().toISOString(),
      });
      logger.detail(`read-file done (${formatDuration(Date.now() - t0)})`);
      return;
    }
    case "if": {
      const taken = evaluatePredicate(step.condition, scope);
      tracker.recordIfOutcome(step, taken);
      logger.detail(`if ${step.condition} -> ${taken ? "true" : "false (skip)"}`);
      if (taken) {
        await runIfStep(step, scope, (child, childScope, j) =>
          runStep(child, childScope, deps, tracker, {
            ...ctx,
            addr: ifChildAddress(ctx.addr, j),
          }, run),
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

/**
 * Skips a leaf step the journal already holds: re-applies its scope
 * assignment, keeps the phase display consistent, and reports true.
 */
function replayIfJournaled(
  step: AgentStep | ScriptStep | ReadFileStep,
  scope: Scope,
  deps: RunFlowDeps,
  ctx: StepContext,
  run: RunState,
  /** Built after the scope effect is re-applied, so the total is current. */
  phaseLine: (() => string) | undefined,
): boolean {
  const record = deps.journal?.has(ctx.addr);
  if (!record) return false;
  const logger = deps.logger ?? silentLogger();
  if (record.set) {
    scope[record.set] = record.value;
  }
  run.replayed += 1;
  const what = step.type === "agent" ? step.prompt : step.type === "script" ? step.name : step.path;
  logger.detail(`${step.type} ${what}: done in an earlier attempt, skipping (${ctx.addr})`);
  if (phaseLine) {
    logger.phaseImmediate(`${phaseLine()} (done in earlier run)`, "SKIP");
  }
  return true;
}

async function runForeachWithPhases(
  step: ForeachStep,
  scope: Scope,
  deps: RunFlowDeps,
  tracker: PhaseTracker,
  parentCtx: StepContext,
  run: RunState,
): Promise<void> {
  await runForeachStep(
    step,
    scope,
    async (child, iterScope, j, i) => {
      if (j === 0) {
        tracker.advance();
      }
      await runStep(child, iterScope, deps, tracker, {
        isTopLevel: false,
        insideForeach: true,
        addr: foreachChildAddress(parentCtx.addr, i, j),
      }, run);
    },
  );
}

async function runLoopWithPhases(
  step: LoopStep,
  scope: Scope,
  deps: RunFlowDeps,
  tracker: PhaseTracker,
  parentCtx: StepContext,
  run: RunState,
): Promise<void> {
  await runLoopStep(step, scope, async (child, iterScope, j, i) => {
    await runStep(child, iterScope, deps, tracker, {
      isTopLevel: false,
      insideForeach: parentCtx.insideForeach,
      loopIteration: i,
      loopMax: step.max,
      addr: loopChildAddress(parentCtx.addr, i, j),
    }, run);
  });
}

async function runAgentStep(
  step: AgentStep,
  scope: Scope,
  deps: RunFlowDeps,
  run: RunState,
): Promise<void> {
  const promptPath = resolve(PROMPTS_DIR, `${step.prompt}.md`);

  const renderedVars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(step.vars ?? {})) {
    renderedVars[key] = interpolate(raw, scope);
  }

  // `includeRoots` is the shared-partial search path. It is a list so that a
  // project's own prompt directory can be prepended ahead of the package's
  // when custom prompts land, without changing the resolver.
  let rendered = await renderPromptFile(promptPath, renderedVars, {
    includeRoots: [PROMPTS_DIR],
  });
  // The first agent step a resumed run actually executes is the one the
  // earlier attempt was interrupted in; tell the agent so once.
  if (run.resumeNote) {
    rendered = `${rendered.trimEnd()}\n\n${run.resumeNote}\n`;
    run.resumeNote = undefined;
  }
  const prompt = appendSaagaRules(rendered, deps.saagaRules);

  // Archive exactly the bytes the agent receives, so a run stays
  // reconstructible now that the plan no longer carries the methodology.
  // `iteration` is a loop-scope value rather than a step var, so it is read
  // from the scope; the archive's own counter is what keeps names unique.
  await deps.promptArchive?.record(
    step.prompt,
    {
      phase: renderedVars.phase_number,
      iteration:
        scope.iteration != null ? String(scope.iteration) : undefined,
    },
    prompt,
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
    signal: deps.signal,
    model: stepModel(step, deps),
  });
  // Checked before the exit code: a cancelled child reports failure, and
  // even a child that happened to finish cleanly was told to stop — its
  // output is not trusted as complete.
  if (deps.signal?.aborted) {
    throw new RunAbortedError(step.prompt);
  }
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

/**
 * The run was stopped through `RunFlowDeps.signal`. `where` names the
 * step (prompt name or journal address) that was current at the time.
 */
export class RunAbortedError extends Error {
  readonly where: string;

  constructor(where: string) {
    super(`Run interrupted at ${where}`);
    this.name = "RunAbortedError";
    this.where = where;
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
