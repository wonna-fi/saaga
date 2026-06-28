#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { Agent } from "./agent/types.js";
import {
  type Backend,
  createAgent,
  defaultModelFor,
  defaultQuickModelFor,
  resolveBackend,
} from "./cli/backend.js";
import { type SaagaConfig, loadConfig } from "./cli/config.js";
import { loadFlow } from "./engine/loader.js";
import { AgentStepFailedError, runFlow } from "./engine/runner.js";
import { Logger } from "./logger.js";
import { PACKAGE_ROOT } from "./paths.js";
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
  /** Override `process.env` for testing (used for HOME/SAAGA_DIR). */
  env?: NodeJS.ProcessEnv;
  /** Override stdout (used by tests to capture --help / --version output). */
  stdout?: NodeJS.WritableStream;
  /** Override stderr (used by tests). */
  stderr?: NodeJS.WritableStream;
}

interface GlobalCliFlags {
  backend?: string;
  model?: string;
  ci?: boolean;
}

interface RuleTargetFlags {
  ruleTarget?: string;
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
    .exitOverride();

  program
    .command("init")
    .description("Generate full initial documentation for an app directory")
    .argument("[dir]", "Path to the application directory (default: cwd)", ".")
    .option(
      "--rule-target <targets>",
      "Comma-separated rule files to install documentation rules into " +
        "(agentsmd|cursor|claude|copilot|none)",
    )
    .action(async (dir: string, cmdOpts: RuleTargetFlags, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalCliFlags;
      await runFlowSubcommand({
        dir,
        flowName: "init",
        subcommand: "init",
        globals,
        options,
        ruleTargetFlag: cmdOpts.ruleTarget,
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
      "--rule-target <targets>",
      "Comma-separated rule files to install documentation rules into " +
        "(agentsmd|cursor|claude|copilot|none)",
    )
    .action(async (dir: string, cmdOpts: RuleTargetFlags, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalCliFlags;
      await runInstallRulesSubcommand({
        dir,
        ruleTargetFlag: cmdOpts.ruleTarget,
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
    .action(async (dir: string, _cmdOpts: unknown, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalCliFlags;
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
    .action(async (dir: string, _cmdOpts: unknown, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalCliFlags;
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
    .action(async (dir: string, _cmdOpts: unknown, cmd) => {
      const globals = cmd.optsWithGlobals() as GlobalCliFlags;
      await runFlowSubcommand({
        dir,
        flowName: "verify-quick-updates",
        subcommand: "verify-quick-updates",
        globals,
        options,
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof AgentStepFailedError) {
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

function resolveAgent(
  globals: GlobalCliFlags,
  options: CliOptions,
  opts: ResolveAgentOpts = {},
): Agent {
  if (options.agent) {
    return options.agent;
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

  return createAgent({ backend, model, ci: globals.ci });
}

interface RunFlowSubcommandInput {
  dir: string;
  flowName: string;
  subcommand: string;
  globals: GlobalCliFlags;
  options: CliOptions;
  useQuickModel?: boolean;
  /** CLI --rule-target flag value (only used by init). */
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
      throw new Error(`Directory not found: ${dir}`);
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  const config = await loadConfig(appPath);
  const appName = basename(appPath);
  const agent = resolveAgent(globals, options, {
    useQuickModel: input.useQuickModel,
    config,
  });
  const logger = createLogger(globals, options);

  const env = options.env ?? process.env;
  const runCtx = await createRunContext({
    app: appName,
    appPath,
    subcommand,
    env,
  });

  logger.info(
    `saaga ${subcommand} ${appPath} (backend=${agent.name}${
      globals.model ? `, model=${globals.model}` : ""
    })`,
  );
  logger.info(`run id: ${runCtx.runId}`);
  logger.info(`run dir: ${runCtx.runDir}`);

  const extraScope: Record<string, unknown> = { ...input.extraScope };
  if (subcommand === "init") {
    extraScope.rule_targets = resolveRuleTargets(input.ruleTargetFlag, config);
  }

  const flow = await loadFlow(flowName);
  await runFlow(
    flow,
    {
      app: appName,
      app_path: appPath,
      run_id: runCtx.runId,
      run_dir: runCtx.runDir,
      date: runCtx.date,
      ...extraScope,
    },
    {
      agent,
      cwd: appPath,
      logger,
    },
  );
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
      throw new Error(`Directory not found: ${dir}`);
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  const config = await loadConfig(appPath);
  const ruleTargets = resolveRuleTargets(input.ruleTargetFlag, config);
  const appName = basename(appPath);
  const logger = createLogger(globals, options);

  logger.info(
    `saaga install-rules ${appPath} (rule-target=${ruleTargets})`,
  );

  await installRules(
    {
      app_dir: appPath,
      app: appName,
      rule_targets: ruleTargets,
    },
    { cwd: appPath },
  );
}

function createLogger(
  globals: GlobalCliFlags,
  options: CliOptions,
): Logger {
  return new Logger({
    ci: globals.ci ?? false,
    stream: options.stderr ?? process.stderr,
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
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
