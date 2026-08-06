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
  backendCliCommand,
  createAgent,
  defaultModelFor,
  defaultQuickModelFor,
  resolveBackend,
} from "./cli/backend.js";
import {
  DEFAULT_DOCS_DIR,
  type SaagaConfig,
  loadConfig,
} from "./cli/config.js";
import {
  ConfirmationDeclinedError,
  buildCostSummary,
  confirmAgentCosts,
} from "./cli/confirm.js";
import { loadFlow } from "./engine/loader.js";
import { AgentStepFailedError, runFlow } from "./engine/runner.js";
import { Logger } from "./logger.js";
import { PACKAGE_ROOT } from "./paths.js";
import { buildProfile, type AgentPermissions } from "./agent/permissions.js";
import { runDoctor, formatDoctorResult, type DoctorOptions } from "./doctor/index.js";
import { runPreflight } from "./doctor/preflight.js";
import { createRunContext } from "./run-context.js";
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
}

interface GlobalCliFlags {
  backend?: string;
  model?: string;
  ci?: boolean;
  verbose?: boolean;
  yes?: boolean;
  allowDir?: string[];
  dangerouslyAllowAll?: boolean;
  auditPermissions?: boolean;
}

interface RuleTargetFlags {
  ruleTargets?: string;
}

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
    .option("-m, --model <name>", "AI model override (defaults per-backend)")
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
      "--dangerously-allow-all",
      "Run without permission restrictions (reproduces legacy behavior)",
    )
    .option(
      "--audit-permissions",
      "Scan agent output for permission denials and log a summary",
    )
    .exitOverride();

  program
    .command("init")
    .description("Generate full initial documentation for an app directory")
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .option(
      "--rule-targets <targets>",
      "Comma-separated rule files to install documentation rules into " +
        "(agentsmd|cursor|claude|copilot|none)",
    )
    .action(async (dir: string, cmdOpts: RuleTargetFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      await runFlowSubcommand({
        dir,
        flowName: "init",
        subcommand: "init",
        globals,
        options,
        ruleTargetFlag: cmdOpts.ruleTargets,
      });
    });

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
      await runInstallRulesSubcommand({
        dir,
        ruleTargetFlag: cmdOpts.ruleTargets,
        globals,
        options,
      });
    });

  program
    .command("update")
    .description(
      "Incrementally update documentation: detect changes since BASELINE, " +
        "regenerate affected slices, refresh BASELINE",
    )
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .action(async (dir: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      await runFlowSubcommand({
        dir,
        flowName: "update",
        subcommand: "update",
        globals,
        options,
      });
    });

  program
    .command("quick-update")
    .description(
      "Fast single-session documentation update: triage changes, update " +
        "affected docs, and record a metadata artifact for later verification. " +
        "Uses a cheaper/faster model by default.",
    )
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .action(async (dir: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      await runFlowSubcommand({
        dir,
        flowName: "quick-update",
        subcommand: "quick-update",
        globals,
        options,
        useQuickModel: true,
      });
    });

  program
    .command("verify-quick-updates")
    .description(
      "Verify, correct, and improve all unverified quick updates. " +
        "Consolidates accumulated quick-update artifacts into a plan, " +
        "runs slice-doc + verify/fix loop per phase, then removes " +
        "processed artifacts.",
    )
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .action(async (dir: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalCliFlags>();
      await runFlowSubcommand({
        dir,
        flowName: "verify-quick-updates",
        subcommand: "verify-quick-updates",
        globals,
        options,
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
    // already defines -b/--backend and -m/--model, and commander binds the
    // long forms to the parent, leaving a subcommand copy stuck at its
    // default. Read them from the globals instead.
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
      const doctorOpts: DoctorOptions = {
        backend: (globals.backend ?? "all") as DoctorOptions["backend"],
        level: (cmdOpts.level ?? "fast") as DoctorOptions["level"],
        json: cmdOpts.json,
        probe: splitProbeIds(cmdOpts.probe),
        model: globals.model,
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

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof AgentStepFailedError) {
      return err.exitCode;
    }
    if (err instanceof ConfirmationDeclinedError) {
      (options.stderr ?? process.stderr).write(`${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof DoctorError) {
      return err.exitCode;
    }
    if (err instanceof PreflightError) {
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
  useQuickModel?: boolean;
  config?: SaagaConfig;
}

/**
 * A resolved agent plus the resolution details needed for the cost notice.
 * `backend` and `model` are absent when the agent was injected via
 * `CliOptions.agent`, since no resolution happened.
 */
interface ResolvedAgent {
  agent: Agent;
  backend?: Backend;
  model?: string;
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
    flag: globals.backend,
    config: config.backend,
  });

  let model: string;
  if (globals.model) {
    model = globals.model;
  } else if (opts.useQuickModel) {
    model = config.quickModel ?? defaultQuickModelFor(backend);
  } else {
    model = config.model ?? defaultModelFor(backend);
  }

  return {
    agent: createAgent({ backend, model, ci: globals.ci }),
    backend,
    model,
  };
}

interface RunFlowSubcommandInput {
  dir: string;
  flowName: string;
  subcommand: string;
  globals: GlobalCliFlags;
  options: CliOptions;
  useQuickModel?: boolean;
  /** CLI --rule-targets flag value (only used by init). */
  ruleTargetFlag?: string;
  /** Additional variables merged into the initial flow scope. */
  extraScope?: Record<string, unknown>;
}

async function runFlowSubcommand(input: RunFlowSubcommandInput): Promise<void> {
  const { dir, flowName, subcommand, globals, options } = input;
  const baseCwd = options.cwd ?? process.cwd();
  const appPath = resolve(baseCwd, dir);

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(appPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directory not found: ${dir}`, { cause: err });
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  const config = await loadConfig(appPath);
  const appName = basename(appPath);
  const resolved = resolveAgent(globals, options, {
    useQuickModel: input.useQuickModel,
    config,
  });
  const agent = resolved.agent;

  const costNotice = {
    subcommand,
    appPath,
    backendCli: resolved.backend
      ? backendCliCommand(resolved.backend)
      : agent.name,
    backend: resolved.backend,
    model: resolved.model,
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

  const runCtx = await createRunContext({
    app: appName,
    appPath,
    subcommand,
  });

  const logFile = resolve(runCtx.runDir, "run.log");
  const verbose = globals.verbose ?? false;
  const logger = createLogger(globals, options, logFile);

  logger.info(
    `saaga ${subcommand} ${appPath} (backend=${agent.name}${
      globals.model ? `, model=${globals.model}` : ""
    })`,
  );
  logger.info(`run ${runCtx.runId} -> ${runCtx.runDir}`);
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

  const flow = await loadFlow(flowName);
  try {
    await runFlow(
      flow,
      {
        app: appName,
        app_path: appPath,
        docs_dir: docsDir,
        run_id: runCtx.runId,
        run_dir: runCtx.runDir,
        date: runCtx.date,
        ...extraScope,
      },
      {
        agent,
        cwd: appPath,
        logger,
        logFile,
        verbose,
        permissions,
        auditor,
      },
    );
  } finally {
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

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(appPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directory not found: ${dir}`, { cause: err });
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  const config = await loadConfig(appPath);
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
