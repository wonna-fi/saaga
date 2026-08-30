#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { PermissionAuditor } from "./agent/audit.js";
import type { Agent } from "./agent/types.js";
import {
  type Backend,
  DEFAULT_MODEL_KEY,
  backendCliCommand,
  createAgent,
  mergeModelOverrides,
  parseModelOverrides,
  resolveBackend,
  resolveModel,
  resolveModels,
} from "./cli/backend.js";
import {
  DEFAULT_DOCS_DIR,
  type SaagaConfig,
  loadConfig,
} from "./cli/config.js";
import {
  findUnknownFeature,
  getEnabledUnstableFeatures,
  initUnstableFeatures,
  resolveUnstableFeatures,
  resetUnstableFeatures,
  UNSTABLE_FEATURES,
} from "./unstable-features.js";
import {
  ConfirmationDeclinedError,
  buildCostSummary,
  confirmAgentCosts,
} from "./cli/confirm.js";
import { agentSteps, flowExists, listFlows, loadFlow } from "./engine/loader.js";
import { flowHash, openJournal, createJournal, type RunJournal } from "./engine/journal.js";
import { AgentStepFailedError, RunAbortedError, runFlow } from "./engine/runner.js";
import { Logger } from "./logger.js";
import { PACKAGE_ROOT } from "./paths.js";
import { buildProfile, type AgentPermissions } from "./agent/permissions.js";
import { runDoctor, formatDoctorResult, type DoctorOptions } from "./doctor/index.js";
import { runPreflight } from "./doctor/preflight.js";
import { createRunContext, reopenRunContext } from "./run-context.js";
import {
  findResumableRun,
  isProcessAlive,
  manifestModels,
  readManifest,
  writeManifest,
  type RunManifest,
} from "./run-manifest.js";
import { loadSaagaRules } from "./saaga-rules.js";
import { installRules, parseRuleTargets } from "./scripts/install-rules.js";

export interface CliOptions {
  /**
   * If provided, the engine uses this agent directly and skips backend
   * resolution. Used by tests; production callers leave this unset and
   * rely on `--backend` flag or `.saaga/config.yaml`.
   */
  agent?: Agent;
  /** Override `process.cwd()` for testing. */
  cwd?: string;
  /** Override stdout (used by tests to capture --help / --version output). */
  stdout?: NodeJS.WritableStream;
  /** Override stderr (used by tests). */
  stderr?: NodeJS.WritableStream;
  /** Override stdin (used by tests to answer the cost confirmation). */
  stdin?: NodeJS.ReadableStream;
  /**
   * Stops a running flow the way Ctrl+C does (used by tests, which cannot
   * deliver a SIGINT to themselves safely).
   */
  signal?: AbortSignal;
}

interface GlobalCliFlags {
  backend?: string;
  /** Raw `<key>=<model>` entries from the repeatable --model flag. */
  model?: string[];
  ci?: boolean;
  verbose?: boolean;
  yes?: boolean;
  allowDir?: string[];
  unstableFeature?: string[];
  dangerouslyAllowAll?: boolean;
  auditPermissions?: boolean;
}

interface RuleTargetFlags {
  ruleTargets?: string;
}

interface RunFlags extends RuleTargetFlags {
  resume?: string;
  continue?: boolean;
}

/** Appended to the prompt of the step a resumed run re-executes. */
const RESUME_NOTE =
  "Note: this step is being re-run because an earlier attempt of this run " +
  "was interrupted part-way through it. Output from that attempt may already " +
  "exist in the documentation directory and the run directory. Read what is " +
  "there before writing, and complete it rather than duplicating it.";

/**
 * Resolves the effective rule-target string from CLI flag, config, or
 * built-in default ("agentsmd"), then validates it. Returns the raw
 * comma-separated string for flow scope / script args.
 */
function resolveRuleTargets(
  flag: string | undefined,
  config: SaagaConfig,
): string {
  const raw = flag ?? config.ruleTargets ?? "agentsmd";
  parseRuleTargets(raw);
  return raw;
}

function resolveDocsDir(config: SaagaConfig): string {
  return config.docsDir ?? DEFAULT_DOCS_DIR;
}

async function validateDirectory(appPath: string, dirArg: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(appPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directory not found: ${dirArg}`, { cause: err });
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dirArg}`);
  }
}

/**
 * Centralized bootstrap for unstable features. Validates the project
 * directory, loads config, validates all feature names (config + CLI),
 * initializes the process-wide registry, and emits a single warning
 * when any features are enabled.
 *
 * Returns the loaded config so subcommand handlers can reuse it
 * without a second disk read.
 */
async function bootstrapUnstableFeatures(
  projectDir: string,
  dirArg: string,
  globals: GlobalCliFlags,
  options: CliOptions,
): Promise<SaagaConfig> {
  await validateDirectory(projectDir, dirArg);
  const config = await loadConfig(projectDir);

  const cliFeatures = globals.unstableFeature ?? [];
  const unknown = findUnknownFeature(cliFeatures);
  if (unknown !== undefined) {
    throw new UnstableFeatureError(unknown);
  }

  const resolved = resolveUnstableFeatures(
    config.unstableFeatures ?? [],
    cliFeatures,
  );
  initUnstableFeatures(resolved);

  const enabled = getEnabledUnstableFeatures();
  if (enabled.length > 0) {
    const stream = options.stderr ?? process.stderr;
    stream.write(
      `[WARN] Unstable features enabled: ${enabled.join(", ")}\n`,
    );
  }

  return config;
}

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(resolve(PACKAGE_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function runCli(
  argv: string[],
  options: CliOptions = {},
): Promise<number> {
  const program = new Command();
  const version = await readPackageVersion();

  if (options.stdout || options.stderr) {
    program.configureOutput({
      writeOut: (str) =>
        (options.stdout ?? process.stdout).write(str),
      writeErr: (str) =>
        (options.stderr ?? process.stderr).write(str),
    });
  }

  program
    .name("saaga")
    .description(
      "Saaga — drive coding agents to write and verify domain docs.\n" +
        "Customize behavior by editing the bundled flow YAML files in flows/.",
    )
    .version(version, "-v, --version", "Print version and exit")
    .option("-b, --backend <name>", "Agent backend (cursor|copilot|claude)")
    .option(
      "--model <key=model>",
      "Set the model for a model key, e.g. --model high=opus (repeatable)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--ci",
      "CI mode: plain (non-color) log output",
    )
    .option(
      "--verbose",
      "Show detailed step output and live agent output on terminal",
    )
    .option(
      "-y, --yes",
      "Skip the cost confirmation prompt for agent-backed commands",
    )
    .option(
      "--allow-dir <path>",
      "Grant additional read/write access to a directory (repeatable)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--unstable-feature <name>",
      "Enable an unstable feature (repeatable)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--dangerously-allow-all",
      "Run without permission restrictions (reproduces legacy behavior)",
    )
    .option(
      "--audit-permissions",
      "Scan agent output for permission denials and log a summary",
    )
    .exitOverride();

  program
    .command("run")
    .description(
      "Run a named flow (omit the flow name to list available flows)",
    )
    .argument("[flow]", "Flow to run (e.g. init, update, quick-update)")
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .option(
      "--rule-targets <targets>",
      "Comma-separated rule files to install documentation rules into " +
        "(agentsmd|cursor|claude|copilot|none) — used by the init flow",
    )
    .option(
      "--resume <run-id>",
      "Resume an interrupted or failed run where it stopped " +
        "(the flow name is taken from the run)",
    )
    .option(
      "--continue",
      "Resume the most recent interrupted or failed run in the directory",
    )
    .action(async (flow: string | undefined, dir: string, cmdOpts: RunFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();

      if (cmdOpts.resume !== undefined || cmdOpts.continue) {
        await runResumeSubcommand({ flow, dir, cmdOpts, globals, options });
        return;
      }

      if (flow === undefined) {
        const flows = await listFlows();
        const stream = options.stdout ?? process.stdout;
        const maxName = Math.max(...flows.map((f) => f.name.length));
        stream.write("Available flows:\n\n");
        for (const f of flows) {
          const desc = f.description ? `  ${f.description}` : "";
          stream.write(`  ${f.name.padEnd(maxName)}${desc}\n`);
        }
        stream.write("\nUsage: saaga run <flow> [dir]\n");
        return;
      }

      if (!(await flowExists(flow))) {
        const flows = await listFlows();
        const names = flows.map((f) => f.name).join(", ");
        throw new Error(`Unknown flow '${flow}'. Available flows: ${names}`);
      }

      const baseCwd = options.cwd ?? process.cwd();
      const config = await bootstrapUnstableFeatures(resolve(baseCwd, dir), dir, globals, options);
      await runFlowSubcommand({
        dir,
        flowName: flow,
        subcommand: flow,
        globals,
        options,
        ruleTargetFlag: cmdOpts.ruleTargets,
        config,
      });
    });

  for (const oldCmd of ["init", "update", "quick-update", "verify-quick-updates"]) {
    program
      .command(oldCmd, { hidden: true })
      .argument("[args...]")
      .allowUnknownOption(true)
      .action(() => {
        throw new DeprecatedCommandError(oldCmd);
      });
  }

  program
    .command("install-rules")
    .description(
      "Install documentation rules into an app directory " +
        "(no agent backend required)",
    )
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .option(
      "--rule-targets <targets>",
      "Comma-separated rule files to install documentation rules into " +
        "(agentsmd|cursor|claude|copilot|none)",
    )
    .action(async (dir: string, cmdOpts: RuleTargetFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      const baseCwd = options.cwd ?? process.cwd();
      const config = await bootstrapUnstableFeatures(resolve(baseCwd, dir), dir, globals, options);
      await runInstallRulesSubcommand({
        dir,
        ruleTargetFlag: cmdOpts.ruleTargets,
        globals,
        options,
        config,
      });
    });

  interface DoctorFlags {
    level?: string;
    json?: boolean;
    probe?: string[];
  }

  program
    .command("doctor")
    .description(
      "Check backend CLI availability and capability probes. " +
        "Fast tier (default) makes zero model calls.",
    )
    // --backend and --model are deliberately not redeclared here. The program
    // already defines them, and optsWithGlobals() lets ancestors overwrite
    // locals — so a subcommand copy of --model would be clobbered by the
    // parent's [] default, silently discarding whatever it collected. Read
    // them from the globals instead. Doctor probes use the `low` model key.
    .option(
      "--level <level>",
      "Probe tier: fast (no model calls) or full",
      "fast",
    )
    .option(
      "--json",
      "Output results as versioned JSON",
    )
    .option(
      "--probe <ids...>",
      "Run only the specified probe IDs (comma- or space-separated)",
    )
    .action(async (cmdOpts: DoctorFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      const baseCwd = options.cwd ?? process.cwd();
      const config = await bootstrapUnstableFeatures(baseCwd, baseCwd, globals, options);
      const doctorOpts: DoctorOptions = {
        backend: (globals.backend ?? "all") as DoctorOptions["backend"],
        level: (cmdOpts.level ?? "fast") as DoctorOptions["level"],
        json: cmdOpts.json,
        probe: splitProbeIds(cmdOpts.probe),
        modelOverrides: parseModelOverrides(globals.model ?? []),
        backendModels: config.backends,
        ci: globals.ci,
      };

      const result = await runDoctor(doctorOpts);

      const stream = options.stdout ?? process.stdout;
      if (doctorOpts.json) {
        stream.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        stream.write(formatDoctorResult(result, { ci: globals.ci }) + "\n");
      }

      if (result.exitCode !== 0) {
        throw new DoctorError(result.exitCode);
      }
    });

  resetUnstableFeatures();

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof AgentStepFailedError) {
      return err.exitCode;
    }
    if (err instanceof RunAbortedError) {
      return 130;
    }
    if (err instanceof ConfirmationDeclinedError) {
      (options.stderr ?? process.stderr).write(`${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof UnstableFeatureError) {
      (options.stderr ?? process.stderr).write(`[ERROR] ${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof DoctorError) {
      return err.exitCode;
    }
    if (err instanceof PreflightError) {
      return err.exitCode;
    }
    if (err instanceof DeprecatedCommandError) {
      (options.stderr ?? process.stderr).write(`${err.message}\n`);
      return err.exitCode;
    }
    if (isCommanderInfoExit(err)) {
      return 0;
    }
    throw err;
  }
  return 0;
}

function isCommanderInfoExit(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "commander.version" || code === "commander.helpDisplayed";
}

interface ResolveAgentOpts {
  /**
   * Model keys the flow's agent steps ask for. Every one is resolved before
   * the run starts, so a key with no model behind it fails immediately rather
   * than part-way through a flow that has already paid for agent calls.
   */
  modelKeys?: readonly string[];
  config?: SaagaConfig;
  /**
   * Backend and model pins of the run being resumed. They sit between config
   * and the CLI flags in precedence, so an explicit `--backend`/`--model`
   * still wins — switching backend is a common reason to resume.
   *
   * Note this pins every key the earlier attempt resolved, including ones
   * that came from built-in defaults, so upgrading Saaga mid-run keeps the
   * run internally consistent.
   */
  defaults?: { backend?: string; models?: Record<string, string> };
}

/**
 * A resolved agent plus the resolution details needed for the cost notice.
 * `backend` and `models` are absent when the agent was injected via
 * `CliOptions.agent`, since no resolution happened.
 */
interface ResolvedAgent {
  agent: Agent;
  backend?: Backend;
  models?: Record<string, string>;
}

function resolveAgent(
  globals: GlobalCliFlags,
  options: CliOptions,
  opts: ResolveAgentOpts = {},
): ResolvedAgent {
  if (options.agent) {
    return { agent: options.agent };
  }
  const config = opts.config ?? {};
  const backend: Backend = resolveBackend({
    flag: globals.backend ?? opts.defaults?.backend,
    config: config.defaultBackend,
  });

  const resumedModels =
    opts.defaults?.backend === backend ? opts.defaults.models : undefined;
  const models = mergeModelOverrides(
    mergeModelOverrides(config.backends?.[backend]?.models, resumedModels),
    parseModelOverrides(globals.model ?? []),
  );

  // The flow's own keys, and only those: seeding the default key here would
  // make the cost notice advertise a model the run never uses.
  const resolved = resolveModels(backend, opts.modelKeys ?? [], models);

  // The agent still carries one model, used whenever a call does not override
  // it. Resolved separately because a flow need not ask for the default key.
  const baseModel = resolveModel(backend, DEFAULT_MODEL_KEY, models);

  return {
    agent: createAgent({ backend, model: baseModel, ci: globals.ci }),
    backend,
    models: resolved,
  };
}

interface RunFlowSubcommandInput {
  dir: string;
  flowName: string;
  subcommand: string;
  globals: GlobalCliFlags;
  options: CliOptions;
  /** CLI --rule-targets flag value (only used by init). */
  ruleTargetFlag?: string;
  /** Additional variables merged into the initial flow scope. */
  extraScope?: Record<string, unknown>;
  /** Pre-loaded config from bootstrap (avoids double disk read). */
  config?: SaagaConfig;
  /** Present when picking an earlier run up where it stopped. */
  resume?: ResumeTarget;
}

/** An earlier run that `--resume`/`--continue` has located and vetted. */
interface ResumeTarget {
  runDir: string;
  manifest: RunManifest;
  journal: RunJournal;
}

interface RunResumeSubcommandInput {
  flow: string | undefined;
  dir: string;
  cmdOpts: RunFlags;
  globals: GlobalCliFlags;
  options: CliOptions;
}

/**
 * `saaga run --resume <id> [dir]` / `saaga run [flow] --continue [dir]`.
 *
 * With `--resume` the flow name is optional, so a lone positional is a
 * directory unless it names a flow.
 */
async function runResumeSubcommand(input: RunResumeSubcommandInput): Promise<void> {
  const { cmdOpts, globals, options } = input;
  if (cmdOpts.resume !== undefined && cmdOpts.continue) {
    throw new Error("--resume and --continue cannot be combined");
  }

  let flowFilter = input.flow;
  let dir = input.dir;
  if (flowFilter !== undefined && !(await flowExists(flowFilter))) {
    if (dir === ".") {
      dir = flowFilter;
      flowFilter = undefined;
    } else {
      const names = (await listFlows()).map((f) => f.name).join(", ");
      throw new Error(`Unknown flow '${flowFilter}'. Available flows: ${names}`);
    }
  }

  const baseCwd = options.cwd ?? process.cwd();
  const appPath = resolve(baseCwd, dir);
  const config = await bootstrapUnstableFeatures(appPath, dir, globals, options);
  const target = await locateResumableRun({
    appPath,
    dirArg: dir,
    runId: cmdOpts.resume,
    flow: flowFilter,
    stderr: options.stderr ?? process.stderr,
  });

  const flowName = target.manifest.flow;
  await runFlowSubcommand({
    dir,
    flowName,
    subcommand: flowName,
    globals,
    options,
    ruleTargetFlag: cmdOpts.ruleTargets,
    config,
    resume: target,
  });
}

interface LocateResumableRunInput {
  appPath: string;
  /** The directory as the user typed it, for messages. */
  dirArg: string;
  runId?: string;
  flow?: string;
  stderr: NodeJS.WritableStream;
}

async function locateResumableRun(
  input: LocateResumableRunInput,
): Promise<ResumeTarget> {
  const runsDir = `${input.dirArg === "." ? "" : `${input.dirArg}/`}.saaga-runs`;
  let runDir: string;
  let manifest: RunManifest;

  if (input.runId !== undefined) {
    runDir = resolve(input.appPath, ".saaga-runs", input.runId);
    try {
      manifest = await readManifest(runDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`run '${input.runId}' not found in ${runsDir}`, { cause: err });
      }
      throw err;
    }
    if (input.flow !== undefined && input.flow !== manifest.flow) {
      throw new Error(
        `run '${input.runId}' is a '${manifest.flow}' run, not '${input.flow}'`,
      );
    }
  } else {
    const found = await findResumableRun(input.appPath, input.flow);
    if (!found) {
      const scope = input.flow ? `'${input.flow}' run` : "run";
      throw new Error(`no resumable ${scope} found in ${runsDir}`);
    }
    ({ runDir, manifest } = found);
  }

  if (manifest.status === "completed") {
    throw new Error(`run '${manifest.runId}' already completed`);
  }
  if (manifest.status === "running") {
    if (isProcessAlive(manifest.pid)) {
      throw new Error(
        `run '${manifest.runId}' is still running (pid ${manifest.pid})`,
      );
    }
    input.stderr.write(
      `[WARN] run '${manifest.runId}' was left as running by a process that ` +
        `no longer exists; resuming\n`,
    );
  }

  const flow = await loadFlow(manifest.flow);
  if (flowHash(flow) !== manifest.flowHash) {
    throw new Error(
      `flow '${manifest.flow}' has changed since run '${manifest.runId}' ` +
        "started; start a new run instead",
    );
  }

  return { runDir, manifest, journal: await openJournal(runDir) };
}

async function runFlowSubcommand(input: RunFlowSubcommandInput): Promise<void> {
  const { dir, flowName, subcommand, globals, options, resume } = input;
  const baseCwd = options.cwd ?? process.cwd();
  const appPath = resolve(baseCwd, dir);

  if (!input.config) {
    await validateDirectory(appPath, dir);
  }

  const config = input.config ?? await loadConfig(appPath);
  const appName = basename(appPath);

  // Loaded before the agent is resolved: the flow's steps name the model keys
  // to resolve, and those feed the cost notice, the manifest and the runner.
  const flow = await loadFlow(flowName);

  const resolved = resolveAgent(globals, options, {
    modelKeys: agentSteps(flow.steps).map((s) => s.model ?? DEFAULT_MODEL_KEY),
    config,
    defaults: resume
      ? {
          backend: resume.manifest.backend,
          models: manifestModels(resume.manifest),
        }
      : undefined,
  });
  const agent = resolved.agent;

  const costNotice = {
    subcommand,
    appPath,
    backendCli: resolved.backend
      ? backendCliCommand(resolved.backend)
      : agent.name,
    backend: resolved.backend,
    models: resolved.models ? [...new Set(Object.values(resolved.models))] : undefined,
  };
  await confirmAgentCosts({
    ...costNotice,
    autoApprove: globals.yes ?? config.autoApprove ?? false,
    ci: globals.ci ?? false,
    stdin: options.stdin ?? process.stdin,
    stream: options.stderr ?? process.stderr,
  });

  if (resolved.backend && !options.agent) {
    const preflight = await runPreflight(resolved.backend);
    if (!preflight.passed) {
      const stream = options.stderr ?? process.stderr;
      stream.write(
        `Preflight check failed for backend '${resolved.backend}'. ` +
          `Run 'saaga doctor --backend ${resolved.backend}' for details.\n`,
      );
      throw new PreflightError(resolved.backend);
    }
  }

  const runCtx = resume
    ? await reopenRunContext({
        app: resume.manifest.app,
        appPath,
        subcommand,
        runId: resume.manifest.runId,
        date: String(resume.manifest.initialScope.date),
        isoDate: String(resume.manifest.initialScope.iso_date),
      })
    : await createRunContext({
        app: appName,
        appPath,
        subcommand,
      });

  const logFile = resolve(runCtx.runDir, "run.log");
  const verbose = globals.verbose ?? false;
  const logger = createLogger(globals, options, logFile);

  const bannerModels = costNotice.models ?? [];
  logger.info(
    `saaga run ${subcommand} ${appPath} (backend=${agent.name}${
      bannerModels.length > 0
        ? `, ${bannerModels.length === 1 ? "model" : "models"}=${bannerModels.join(", ")}`
        : ""
    })`,
  );
  if (resume) {
    const attempt = resume.manifest.resumedAt.length + 2;
    logger.info(
      `resuming run ${runCtx.runId} (attempt ${attempt}, ` +
        `${resume.journal.size()} steps already done) -> ${runCtx.runDir}`,
    );
  } else {
    logger.info(`run ${runCtx.runId} -> ${runCtx.runDir}`);
  }
  logger.detail(buildCostSummary(costNotice));

  const docsDir = resolveDocsDir(config);

  let permissions: AgentPermissions | undefined;
  if (globals.dangerouslyAllowAll) {
    (options.stderr ?? process.stderr).write(
      "WARNING: --dangerously-allow-all is set. " +
        "The agent runs without permission restrictions.\n",
    );
  } else {
    permissions = buildProfile({
      appPath,
      docsDir,
      runDir: runCtx.runDir,
      allowDirs: globals.allowDir,
    });
  }

  await writeFile(
    resolve(runCtx.runDir, "permissions.json"),
    JSON.stringify(
      {
        mode: permissions ? "restricted" : "unrestricted",
        profile: permissions ?? null,
      },
      null,
      2,
    ) + "\n",
  );

  if (!config.docsDir && docsDir === DEFAULT_DOCS_DIR) {
    const hasLegacy = await isFile(resolve(appPath, "docs", "BASELINE"));
    const hasCurrent = await isFile(resolve(appPath, docsDir, "BASELINE"));
    if (hasLegacy && !hasCurrent) {
      logger.warn(
        `found legacy docs/ with a BASELINE; set 'docsDir: docs' in .saaga/config.yaml to keep it, or migrate its contents to ${DEFAULT_DOCS_DIR}/`,
      );
    }
  }

  const extraScope: Record<string, unknown> = { ...input.extraScope };
  if (subcommand === "init") {
    extraScope.rule_targets = resolveRuleTargets(input.ruleTargetFlag, config);
  }

  // Auditing needs a profile to judge denials against, and an unrestricted
  // run produces none anyway.
  const auditor =
    globals.auditPermissions && permissions
      ? new PermissionAuditor(
          permissions,
          appPath,
          resolve(runCtx.runDir, "permission-audit.log"),
        )
      : undefined;
  if (globals.auditPermissions && !permissions) {
    logger.warn(
      "--audit-permissions has no effect without a permission profile; ignoring",
    );
  }
  if (auditor) {
    logger.warn(
      `--audit-permissions: agent output in ${logFile} will be JSON for this run`,
    );
  }

  const saagaRules = await loadSaagaRules(appPath);

  const initialScope: Record<string, unknown> = resume
    ? resume.manifest.initialScope
    : {
        app: appName,
        app_path: appPath,
        docs_dir: docsDir,
        run_id: runCtx.runId,
        run_dir: runCtx.runDir,
        date: runCtx.date,
        iso_date: runCtx.isoDate,
        ...extraScope,
      };

  const now = new Date().toISOString();
  const manifest: RunManifest = resume
    ? {
        ...resume.manifest,
        backend: resolved.backend ?? resume.manifest.backend,
        models: resolved.models ?? resume.manifest.models,
        status: "running",
        pid: process.pid,
        resumedAt: [...resume.manifest.resumedAt, now],
        lastError: undefined,
      }
    : {
        runId: runCtx.runId,
        flow: flowName,
        flowHash: flowHash(flow),
        app: appName,
        appPath,
        docsDir,
        backend: resolved.backend,
        models: resolved.models,
        initialScope,
        status: "running",
        pid: process.pid,
        startedAt: now,
        resumedAt: [],
      };
  await writeManifest(runCtx.runDir, manifest);
  const journal = resume?.journal ?? createJournal(runCtx.runDir);

  // Ctrl+C stops the run cooperatively: the agent child is told to exit,
  // the manifest records the interruption, and the resume command is
  // printed. A second Ctrl+C exits immediately.
  //
  // `on`, not `once`: execa's child cleanup (signal-exit) re-raises the
  // signal when it finds itself the only SIGINT listener, and `once`
  // removes ours before invoking it — which would kill the process before
  // the interruption is recorded.
  const controller = new AbortController();
  const abort = () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  };
  process.on("SIGINT", abort);
  options.signal?.addEventListener("abort", abort, { once: true });

  const resumeHint =
    `To resume: saaga run --resume ${runCtx.runId}` +
    (dir === "." ? "" : ` ${dir}`);
  const stderr = options.stderr ?? process.stderr;

  try {
    await runFlow(flow, initialScope, {
      agent,
      models: resolved.models,
      cwd: appPath,
      logger,
      logFile,
      verbose,
      permissions,
      auditor,
      saagaRules,
      journal,
      signal: controller.signal,
      resumeNote: resume ? RESUME_NOTE : undefined,
    });
    await writeManifest(runCtx.runDir, { ...manifest, status: "completed" });
  } catch (err) {
    const interrupted = err instanceof RunAbortedError;
    await writeManifest(runCtx.runDir, {
      ...manifest,
      status: interrupted ? "interrupted" : "failed",
      lastError: err instanceof Error ? err.message : String(err),
    });
    stderr.write(`${interrupted ? "interrupted" : "failed"}. ${resumeHint}\n`);
    throw err;
  } finally {
    process.off("SIGINT", abort);
    options.signal?.removeEventListener("abort", abort);
    if (auditor) await reportAudit(auditor, logger);
    logger.dispose();
  }
}

/**
 * Accept probe ids separated by commas as well as spaces.
 *
 * Commander's variadic option only splits on spaces, so a comma-separated
 * list arrived as one unmatchable id and silently selected no probes at all.
 */
function splitProbeIds(ids?: string[]): string[] | undefined {
  if (!ids) return undefined;
  const split = ids.flatMap((id) => id.split(",")).filter((id) => id.length > 0);
  return split.length > 0 ? split : undefined;
}

/**
 * Write the audit log and surface the one class that needs acting on.
 *
 * A denial inside a granted root means the profile is wrong for this backend
 * or CLI version, and the run has quietly produced less than it should have,
 * so it is worth a warning rather than a line in a file nobody opens.
 */
async function reportAudit(auditor: PermissionAuditor, logger: Logger): Promise<void> {
  const result = await auditor.flush();
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  logger.info(`permission audit: ${total} denials -> ${result.logPath}`);
  for (const entry of result.unexpected) {
    logger.warn(
      `denied inside a granted path: ${entry.event.tool} ${entry.resolvedPath ?? ""} — ${entry.event.message}`,
    );
  }
  if (result.counts["out-of-workspace"] > 0) {
    logger.info(
      `${result.counts["out-of-workspace"]} denial(s) outside the workspace; see the audit log if docs look incomplete`,
    );
  }
}

interface RunInstallRulesSubcommandInput {
  dir: string;
  ruleTargetFlag?: string;
  globals: GlobalCliFlags;
  options: CliOptions;
  /** Pre-loaded config from bootstrap (avoids double disk read). */
  config?: SaagaConfig;
}

/**
 * Standalone install of documentation rules. Deliberately skips backend
 * resolution and run-context creation: the installer is a deterministic
 * local file operation and must work without agent credentials.
 */
async function runInstallRulesSubcommand(
  input: RunInstallRulesSubcommandInput,
): Promise<void> {
  const { dir, globals, options } = input;
  const baseCwd = options.cwd ?? process.cwd();
  const appPath = resolve(baseCwd, dir);

  if (!input.config) {
    await validateDirectory(appPath, dir);
  }

  const config = input.config ?? await loadConfig(appPath);
  const ruleTargets = resolveRuleTargets(input.ruleTargetFlag, config);
  const docsDir = resolveDocsDir(config);
  const appName = basename(appPath);
  const logger = createLogger(globals, options);

  logger.info(
    `saaga install-rules ${appPath} (rule-targets=${ruleTargets})`,
  );

  await installRules(
    {
      app_dir: appPath,
      app: appName,
      rule_targets: ruleTargets,
      docs_dir: docsDir,
    },
    { cwd: appPath },
  );
}

function createLogger(
  globals: GlobalCliFlags,
  options: CliOptions,
  logFile?: string,
): Logger {
  return new Logger({
    ci: globals.ci ?? false,
    stream: options.stderr ?? process.stderr,
    logFile,
    verbose: globals.verbose ?? false,
  });
}

async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

class UnstableFeatureError extends Error {
  readonly exitCode = 1;

  constructor(name: string) {
    super(
      `Unknown unstable feature '${name}' (available: ${UNSTABLE_FEATURES.join(", ")})`,
    );
    this.name = "UnstableFeatureError";
  }
}

class PreflightError extends Error {
  readonly exitCode = 1;

  constructor(backend: string) {
    super(`Preflight check failed for backend '${backend}'`);
    this.name = "PreflightError";
  }
}

class DoctorError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`doctor: probes ${exitCode === 1 ? "failed" : "could not run"}`);
    this.name = "DoctorError";
    this.exitCode = exitCode;
  }
}

class DeprecatedCommandError extends Error {
  readonly exitCode = 1;

  constructor(oldCommand: string) {
    super(
      `'saaga ${oldCommand}' has moved — use: saaga run ${oldCommand}`,
    );
    this.name = "DeprecatedCommandError";
  }
}

function isMainModule(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(argv1) === modulePath;
  } catch {
    return argv1 === modulePath;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ERROR] ${message}\n`);
      process.exit(1);
    },
  );
}
