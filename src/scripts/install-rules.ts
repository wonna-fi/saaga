import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { RULES_DIR } from "../paths.js";
import { renderPromptFile } from "../templates.js";
import type { ScriptContext } from "./registry.js";

export const RULE_TARGETS = [
  "agentsmd",
  "cursor",
  "claude",
  "copilot",
] as const;

export type RuleTarget = (typeof RULE_TARGETS)[number];

interface RuleTargetSpec {
  /** Rule file path relative to the app dir. */
  path: string;
  /**
   * Template (in RULES_DIR) that wraps the rule body for files fully
   * owned by Saaga (carries the format's YAML frontmatter). Targets
   * without a template are shared files updated via the managed block.
   */
  ownedTemplate?: string;
}

const RULE_SPEC: Record<RuleTarget, RuleTargetSpec> = {
  // AGENTS.md and CLAUDE.md are plain-markdown standards: no frontmatter,
  // and the file may contain user content, so only the managed block is
  // touched.
  agentsmd: { path: "AGENTS.md" },
  claude: { path: "CLAUDE.md" },
  cursor: {
    path: ".cursor/rules/domain-docs.mdc",
    ownedTemplate: "cursor-rule.mdc",
  },
  // Copilot's frontmatter-bearing format is the path-specific
  // `.instructions.md` file (`applyTo` glob); `.github/copilot-instructions.md`
  // is plain markdown by spec and takes no frontmatter.
  copilot: {
    path: ".github/instructions/domain-docs.instructions.md",
    ownedTemplate: "copilot-rule.md",
  },
};

export const MANAGED_BLOCK_BEGIN = "<!-- saaga:begin -->";
export const MANAGED_BLOCK_END = "<!-- saaga:end -->";

/**
 * Parses a comma-separated rule target list. `none` entries are dropped
 * (so `--rule-target none` yields an empty list). Duplicates are removed,
 * order preserved. Throws on unknown values, and on input that carries no
 * meaningful token at all (empty or whitespace-only) so callers fail fast
 * instead of treating it as a silent no-op.
 */
export function parseRuleTargets(raw: string): RuleTarget[] {
  const result: RuleTarget[] = [];
  let sawToken = false;
  for (const token of raw.split(",")) {
    const value = token.trim();
    if (value.length === 0) continue;
    sawToken = true;
    if (value === "none") continue;
    if (!RULE_TARGETS.includes(value as RuleTarget)) {
      throw new Error(
        `install-rules: invalid rule target '${value}' ` +
          `(allowed: ${RULE_TARGETS.join(", ")}, none)`,
      );
    }
    if (!result.includes(value as RuleTarget)) {
      result.push(value as RuleTarget);
    }
  }
  if (!sawToken) {
    throw new Error(
      "install-rules: no rule target specified " +
        `(allowed: ${RULE_TARGETS.join(", ")}, none)`,
    );
  }
  return result;
}

export interface InstallRulesArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Application name (used in rendered templates). */
  app: string;
  /** Comma-separated rule targets (agentsmd|cursor|claude|copilot|none). */
  rule_targets: string;
}

/**
 * Installs the always-on documentation rules into the requested rule
 * files. Deterministic and idempotent: managed-block files are upserted
 * between markers, owned files (the Cursor `.mdc`) are overwritten.
 */
export async function installRules(
  args: InstallRulesArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("install-rules: 'app_dir' arg is required");
  }
  if (!args.app) {
    throw new Error("install-rules: 'app' arg is required");
  }
  if (args.rule_targets == null || args.rule_targets === "") {
    throw new Error("install-rules: 'rule_targets' arg is required");
  }

  const ruleTargets = parseRuleTargets(args.rule_targets);
  if (ruleTargets.length === 0) return;

  const ruleBody = (
    await renderPromptFile(join(RULES_DIR, "rule-stub.md"), {
      app: args.app,
    })
  ).trimEnd();

  for (const target of ruleTargets) {
    const spec = RULE_SPEC[target];
    const rulePath = resolve(appDir, spec.path);
    await mkdir(dirname(rulePath), { recursive: true });

    if (spec.ownedTemplate) {
      const content = await renderPromptFile(
        join(RULES_DIR, spec.ownedTemplate),
        { app: args.app, rule_body: ruleBody },
      );
      await writeFile(rulePath, content, "utf8");
    } else {
      await upsertManagedBlock(rulePath, ruleBody);
    }
  }
}

/**
 * Writes `body` into `filePath` between the Saaga markers. Creates
 * the file when missing, replaces an existing marker block, or appends
 * a new block when the file exists without markers.
 */
async function upsertManagedBlock(
  filePath: string,
  body: string,
): Promise<void> {
  const block = `${MANAGED_BLOCK_BEGIN}\n${body}\n${MANAGED_BLOCK_END}`;

  let existing: string | null = null;
  try {
    existing = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  if (existing === null) {
    await writeFile(filePath, `${block}\n`, "utf8");
    return;
  }

  const beginIdx = existing.indexOf(MANAGED_BLOCK_BEGIN);
  const endIdx =
    beginIdx === -1
      ? -1
      : existing.indexOf(MANAGED_BLOCK_END, beginIdx + MANAGED_BLOCK_BEGIN.length);

  if (beginIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + MANAGED_BLOCK_END.length);
    await writeFile(filePath, `${before}${block}${after}`, "utf8");
    return;
  }

  const separator = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  await writeFile(filePath, `${existing}${separator}${block}\n`, "utf8");
}
