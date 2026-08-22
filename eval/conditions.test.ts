import { readFile, readdir, readlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, describe, expect, test } from "vitest";
import { stripDocsRouting } from "./src/conditions.js";
import { createSandbox, type Sandbox } from "./src/sandbox.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("stripDocsRouting", () => {
  test("removes the routing section from the real AGENTS.md, keeping the rest", async () => {
    const original = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    expect(original).toContain("## Documentation");

    const stripped = stripDocsRouting(original);
    expect(stripped).not.toContain("## Documentation");
    expect(stripped).not.toContain("saaga-docs/concepts/INDEX.md");
    expect(stripped).toContain("## Development Rules");
    expect(stripped).toContain("Definition of Done");
  });

  test("drops a section that runs to the end of the file", () => {
    const md = "# Title\n\nIntro.\n\n## Documentation\n\nRead the docs.\n";
    expect(stripDocsRouting(md)).toBe("# Title\n\nIntro.\n");
  });

  test("keeps subsections inside the routing section out of the result", () => {
    const md = [
      "## Documentation",
      "",
      "### Domain Documentation",
      "",
      "table here",
      "",
      "## Development Rules",
      "",
      "rules here",
      "",
    ].join("\n");
    const stripped = stripDocsRouting(md);
    expect(stripped).not.toContain("Domain Documentation");
    expect(stripped).toContain("## Development Rules");
    expect(stripped).toContain("rules here");
  });

  test("returns input unchanged when there is no routing section", () => {
    const md = "# Title\n\n## Development Rules\n\nrules\n";
    expect(stripDocsRouting(md)).toBe(md);
  });
});

describe("createSandbox", () => {
  const sandboxes: Sandbox[] = [];
  afterAll(async () => {
    await Promise.all(sandboxes.map((s) => s.cleanup()));
  });

  async function make(condition: "no-docs" | "saaga-docs"): Promise<Sandbox> {
    const sandbox = await createSandbox({ repoRoot, rev: "HEAD", condition });
    sandboxes.push(sandbox);
    return sandbox;
  }

  test("no-docs sandbox has no corpus, no routing section, and no history", async () => {
    const { sandboxDir } = await make("no-docs");

    await expect(readdir(join(sandboxDir, "saaga-docs"))).rejects.toThrow();

    const agentsMd = await readFile(join(sandboxDir, "AGENTS.md"), "utf8");
    expect(agentsMd).not.toContain("## Documentation");
    expect(agentsMd).toContain("## Development Rules");

    // CLAUDE.md must stay a symlink to the stripped AGENTS.md.
    expect(await readlink(join(sandboxDir, "CLAUDE.md"))).toBe("AGENTS.md");
    const claudeMd = await readFile(join(sandboxDir, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain("## Documentation");

    // Exactly one commit and a clean tree: git must not reveal what changed.
    const log = await execa("git", ["log", "--oneline"], { cwd: sandboxDir });
    expect(log.stdout.trim().split("\n")).toHaveLength(1);
    const status = await execa("git", ["status", "--porcelain"], { cwd: sandboxDir });
    expect(status.stdout.trim()).toBe("");
    const show = await execa("git", ["show", "--stat", "HEAD"], { cwd: sandboxDir });
    expect(show.stdout).not.toContain("saaga-docs/");
  });

  test("saaga-docs sandbox keeps the corpus and the routing section", async () => {
    const { sandboxDir } = await make("saaga-docs");

    const docs = await readdir(join(sandboxDir, "saaga-docs"));
    expect(docs).toContain("concepts");

    const agentsMd = await readFile(join(sandboxDir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Documentation");
  });

  test("openwiki condition without a wiki dir is a hard error", async () => {
    await expect(
      createSandbox({ repoRoot, rev: "HEAD", condition: "openwiki" }),
    ).rejects.toThrow(/openwiki/);
  });
});
