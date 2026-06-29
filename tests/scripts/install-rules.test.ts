import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MANAGED_BLOCK_BEGIN,
  MANAGED_BLOCK_END,
  installRules,
  parseRuleTargets,
} from "../../src/scripts/install-rules.js";

async function tmpApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "saaga-install-"));
  const app = join(root, "myapp");
  await mkdir(app);
  return app;
}

const ctx = { cwd: "/unused" };

function defaultArgs(app: string) {
  return {
    app_dir: app,
    app: "myapp",
    rule_targets: "agentsmd",
    docs_dir: "saaga-docs",
  };
}

describe("parseRuleTargets", () => {
  test("parses comma-separated lists, trims, dedupes, preserves order", () => {
    expect(parseRuleTargets("cursor, agentsmd,cursor")).toEqual([
      "cursor",
      "agentsmd",
    ]);
    expect(parseRuleTargets("claude,copilot")).toEqual(["claude", "copilot"]);
  });

  test("'none' yields an empty list", () => {
    expect(parseRuleTargets("none")).toEqual([]);
    expect(parseRuleTargets("none,none")).toEqual([]);
  });

  test("throws on empty or whitespace-only input (no silent no-op)", () => {
    expect(() => parseRuleTargets("")).toThrow(
      /install-rules: no rule target specified/,
    );
    expect(() => parseRuleTargets("   ")).toThrow(
      /install-rules: no rule target specified/,
    );
    expect(() => parseRuleTargets(", ,")).toThrow(
      /install-rules: no rule target specified/,
    );
  });

  test("throws on unknown values, listing allowed ones", () => {
    expect(() => parseRuleTargets("agentsmd,bogus")).toThrow(
      /install-rules: invalid rule target 'bogus' \(allowed: agentsmd, cursor, claude, copilot, none\)/,
    );
  });
});

describe("install-rules script", () => {
  test("default target: creates AGENTS.md managed block with full guidance", async () => {
    const app = await tmpApp();
    await installRules(defaultArgs(app), ctx);

    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(MANAGED_BLOCK_BEGIN);
    expect(agentsMd).toContain(MANAGED_BLOCK_END);
    expect(agentsMd).toContain("### Domain Documentation (myapp)");
    // Behavioral rules.
    expect(agentsMd).toContain("Docs first");
    expect(agentsMd).toContain("No documentation updates during implementation");
    expect(agentsMd).toContain("Consult before implementing");
    // Navigation content folded into the rule body.
    expect(agentsMd).toContain("saaga-docs/concepts/INDEX.md");
    expect(agentsMd).toContain("saaga-docs/patterns/INDEX.md");
    expect(agentsMd).toContain("saaga-docs/features/INDEX.md");
    // No unrendered placeholders left behind.
    expect(agentsMd).not.toContain("{app}");
  });

  test("managed block is appended to an existing AGENTS.md without markers", async () => {
    const app = await tmpApp();
    const original = "# My Project\n\nSome existing content.\n";
    await writeFile(join(app, "AGENTS.md"), original, "utf8");

    await installRules(defaultArgs(app), ctx);

    const content = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(content.startsWith("# My Project")).toBe(true);
    expect(content).toContain("Some existing content.");
    expect(content).toContain(MANAGED_BLOCK_BEGIN);
    expect(content.indexOf(MANAGED_BLOCK_BEGIN)).toBeGreaterThan(
      content.indexOf("Some existing content."),
    );
  });

  test("re-running replaces the existing managed block (idempotent)", async () => {
    const app = await tmpApp();
    await writeFile(
      join(app, "AGENTS.md"),
      `# Top\n\n${MANAGED_BLOCK_BEGIN}\nold stale content\n${MANAGED_BLOCK_END}\n\n## Tail\n`,
      "utf8",
    );

    await installRules(defaultArgs(app), ctx);
    const first = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(first).not.toContain("old stale content");
    expect(first.startsWith("# Top")).toBe(true);
    expect(first).toContain("## Tail");
    expect(first.match(/saaga:begin/g)).toHaveLength(1);

    await installRules(defaultArgs(app), ctx);
    const second = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(second).toBe(first);
  });

  test("cursor rule target writes an owned .mdc file with alwaysApply", async () => {
    const app = await tmpApp();
    await installRules({ ...defaultArgs(app), rule_targets: "cursor" }, ctx);

    const mdc = await readFile(
      join(app, ".cursor", "rules", "domain-docs.mdc"),
      "utf8",
    );
    expect(mdc).toContain("alwaysApply: true");
    expect(mdc).toContain("Domain documentation rules for myapp");
    expect(mdc).toContain("### Domain Documentation (myapp)");
    expect(mdc).not.toContain(MANAGED_BLOCK_BEGIN);
  });

  test("claude target writes a managed block; copilot writes an owned .instructions.md", async () => {
    const app = await tmpApp();
    await installRules(
      { ...defaultArgs(app), rule_targets: "claude,copilot" },
      ctx,
    );

    const claude = await readFile(join(app, "CLAUDE.md"), "utf8");
    expect(claude).toContain(MANAGED_BLOCK_BEGIN);

    const copilot = await readFile(
      join(app, ".github", "instructions", "domain-docs.instructions.md"),
      "utf8",
    );
    expect(copilot.startsWith("---\n")).toBe(true);
    expect(copilot).toContain('applyTo: "**"');
    expect(copilot).toContain("Domain documentation rules for myapp");
    expect(copilot).toContain("### Domain Documentation (myapp)");
    expect(copilot).not.toContain(MANAGED_BLOCK_BEGIN);

    // Non-requested targets are untouched.
    await expect(stat(join(app, "AGENTS.md"))).rejects.toThrow();
  });

  test("rule_targets none installs nothing", async () => {
    const app = await tmpApp();
    await installRules({ ...defaultArgs(app), rule_targets: "none" }, ctx);
    await expect(stat(join(app, "AGENTS.md"))).rejects.toThrow();
    await expect(stat(join(app, ".cursor"))).rejects.toThrow();
  });

  test("throws on missing required args", async () => {
    const app = await tmpApp();
    await expect(
      installRules({ ...defaultArgs(app), app_dir: "" }, ctx),
    ).rejects.toThrow(/'app_dir' arg is required/);
    await expect(
      installRules({ ...defaultArgs(app), app: "" }, ctx),
    ).rejects.toThrow(/'app' arg is required/);
    await expect(
      installRules({ ...defaultArgs(app), rule_targets: "" }, ctx),
    ).rejects.toThrow(/'rule_targets' arg is required/);
  });

  test("throws on invalid target values", async () => {
    const app = await tmpApp();
    await expect(
      installRules({ ...defaultArgs(app), rule_targets: "vscode" }, ctx),
    ).rejects.toThrow(/invalid rule target 'vscode'/);
  });
});
