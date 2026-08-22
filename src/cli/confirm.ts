import { createInterface } from "node:readline/promises";

const PROMPT = "Continue? [y/N] ";

/**
 * Relative cost expectations per agent-backed subcommand. Mirrors the
 * "Runtime and cost" table in README.md.
 */
const COST_HINTS: Record<string, string> = {
  init:
    "init is the heaviest command: it drives several agent phases across the " +
    "whole codebase, so expect a long run and a large one-time token spend.",
  update:
    "update re-documents only the slices that changed since BASELINE, so its " +
    "cost scales with the size of the change.",
  "quick-update":
    "quick-update is a single agent session on a cheaper model — the " +
    "lightest agent-backed command.",
  "verify-quick-updates":
    "verify-quick-updates is one consolidation and verification session; its " +
    "cost scales with the number of pending quick updates.",
};

export class ConfirmationDeclinedError extends Error {
  readonly exitCode = 1;

  constructor(message = "aborted: cost confirmation declined") {
    super(message);
    this.name = "ConfirmationDeclinedError";
  }
}

export interface CostNoticeInput {
  subcommand: string;
  appPath: string;
  /** Name of the backend CLI binary that will be executed. */
  backendCli: string;
  /** Resolved backend key; absent when the agent was injected directly. */
  backend?: string;
  /** Resolved model; absent when the agent was injected directly. */
  model?: string;
}

export interface CostConfirmationInput extends CostNoticeInput {
  /** `--yes` flag or `autoApprove` config: run without asking. */
  autoApprove: boolean;
  ci: boolean;
  stdin?: NodeJS.ReadableStream;
  stream: NodeJS.WritableStream;
}

/** The multi-line cost disclaimer shown before an agent-backed run. */
export function buildCostNotice(input: CostNoticeInput): string {
  const lines = [
    `Cost notice: 'saaga run ${input.subcommand}' will run the ` +
      `'${input.backendCli}' CLI${describeResolution(input)} as an ` +
      `autonomous coding agent over ${input.appPath}.`,
    `Agent sessions consume tokens that are billed to your own ` +
      `${input.backendCli} account, at whatever rate your plan with that ` +
      `provider applies. Saaga does not include or cover any of that usage.`,
  ];
  const hint = COST_HINTS[input.subcommand];
  if (hint) {
    lines.push(hint);
  }
  return lines.join("\n");
}

/** One-line variant for run.log, where the full notice would be noise. */
export function buildCostSummary(input: CostNoticeInput): string {
  return (
    `cost notice acknowledged (cli=${input.backendCli}` +
    `${input.model ? `, model=${input.model}` : ""})`
  );
}

/**
 * Shows the cost disclaimer and, when running interactively, asks the user to
 * confirm. Throws `ConfirmationDeclinedError` when the user declines.
 *
 * Non-interactive invocations (piped stdin, `--ci`) print the notice and
 * continue: blocking there would hang scripted and CI usage.
 */
export async function confirmAgentCosts(
  input: CostConfirmationInput,
): Promise<void> {
  if (input.autoApprove) {
    input.stream.write(
      `${buildCostNotice(input)}\nConfirmation auto-approved.\n\n`,
    );
    return;
  }

  input.stream.write(
    `${buildCostNotice(input)}\n` +
      "Skip this prompt with --yes, or set 'autoApprove: true' in " +
      ".saaga/config.yaml.\n",
  );

  if (!isInteractive(input)) {
    input.stream.write(
      "Non-interactive terminal: continuing without confirmation.\n\n",
    );
    return;
  }

  if (!(await ask(input))) {
    throw new ConfirmationDeclinedError();
  }
  input.stream.write("\n");
}

function describeResolution(input: CostNoticeInput): string {
  const parts: string[] = [];
  if (input.backend) parts.push(`backend ${input.backend}`);
  if (input.model) parts.push(`model ${input.model}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function isInteractive(input: CostConfirmationInput): boolean {
  if (input.ci) return false;
  const stdin = input.stdin;
  if (!stdin) return false;
  return (stdin as { isTTY?: boolean }).isTTY === true;
}

async function ask(input: CostConfirmationInput): Promise<boolean> {
  const rl = createInterface({
    input: input.stdin as NodeJS.ReadableStream,
    output: input.stream,
  });
  try {
    // A closed stream (EOF) never resolves the question, so race it.
    const eof = new Promise<null>((resolve) => {
      rl.once("close", () => resolve(null));
    });
    const answer = await Promise.race([rl.question(PROMPT), eof]);
    if (answer === null) {
      return false;
    }
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
