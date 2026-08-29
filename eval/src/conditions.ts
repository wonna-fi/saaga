import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ConditionId } from "./types.js";

/**
 * Condition mutations applied to a sandbox BEFORE its initial git commit,
 * so the sandbox history never reveals what was removed.
 *
 * The "no-docs" arm must strip every routing surface that points an agent
 * at the docs, not just the corpus itself — otherwise the condition leaks
 * (see plans/eval-seed-material.md, "Condition isolation").
 */

/** Section heading whose block routes agents to the docs corpus. */
const DOCS_ROUTING_HEADING = "## Documentation";

/**
 * Remove the docs-routing section from an AGENTS.md-style document.
 *
 * This repo's AGENTS.md has no saaga-managed block markers — the routing
 * section is hand-maintained — so the strip works by heading: everything
 * from `## Documentation` up to (exclusive) the next `## ` heading is
 * dropped. Returns the input unchanged when the heading is absent.
 */
export function stripDocsRouting(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === DOCS_ROUTING_HEADING);
  if (start === -1) return markdown;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  // Collapse the leftover blank run where the section used to be.
  const out: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && out.length > 0 && out[out.length - 1].trim() === "") continue;
    out.push(line);
  }
  while (out.length > 0 && out[0].trim() === "") out.shift();
  return out.join("\n");
}

export interface ApplyConditionOptions {
  /** Pre-generated OpenWiki wiki directory, required for the openwiki arm. */
  openwikiDir?: string;
}

/**
 * Mutate an exported (not yet committed) sandbox tree for a condition.
 */
export async function applyCondition(
  sandboxDir: string,
  condition: ConditionId,
  opts: ApplyConditionOptions = {},
): Promise<void> {
  switch (condition) {
    case "saaga-docs":
      return;
    case "no-docs":
      await stripDocsSurfaces(sandboxDir);
      return;
    case "docs-only":
      await stripToDocsOnly(sandboxDir);
      return;
    case "openwiki": {
      if (!opts.openwikiDir) {
        throw new Error(
          "openwiki condition is not implemented beyond restoring a pre-generated wiki — pass --openwiki-dir <dir>",
        );
      }
      await stripDocsSurfaces(sandboxDir);
      await cp(opts.openwikiDir, join(sandboxDir, basename(opts.openwikiDir)), {
        recursive: true,
      });
      return;
    }
  }
}

/**
 * Files a docs-only sandbox keeps. Everything else is answer-bearing and
 * removed: source, tests, flows/prompts, README/DEVELOPING (they would
 * measure README quality, not the corpus), and .saaga/config.yaml (it
 * literally contains answers such as the fallback-backend field).
 * CLAUDE.md is the symlink to AGENTS.md; .gitignore keeps the run dir
 * out of git status during the run.
 */
const DOCS_ONLY_KEEP = new Set(["saaga-docs", "AGENTS.md", "CLAUDE.md", ".gitignore"]);

/**
 * The closed-book condition: the agent gets the corpus and its routing,
 * nothing else. Measures corpus coverage/depth (neutral half) and corpus
 * accuracy (defect half: a faithful agent repeating a stale claim fails
 * the check, which is the corpus being wrong, measured). Immune to the
 * ceiling effect where a strong model answers everything from source.
 */
async function stripToDocsOnly(sandboxDir: string): Promise<void> {
  for (const entry of await readdir(sandboxDir)) {
    if (DOCS_ONLY_KEEP.has(entry)) continue;
    await rm(join(sandboxDir, entry), { recursive: true, force: true });
  }
}

async function stripDocsSurfaces(sandboxDir: string): Promise<void> {
  await rm(join(sandboxDir, "saaga-docs"), { recursive: true, force: true });
  // AGENTS.md is the real file; CLAUDE.md is a symlink to it, so editing
  // AGENTS.md in place updates both without breaking the link.
  const agentsMd = join(sandboxDir, "AGENTS.md");
  const original = await readFile(agentsMd, "utf8").catch(() => undefined);
  if (original !== undefined) {
    await writeFile(agentsMd, stripDocsRouting(original));
  }
  // Not present in this repo today; stripped defensively so the condition
  // stays airtight if routing surfaces are added later.
  await rm(join(sandboxDir, ".saagarules"), { force: true });
  await rm(join(sandboxDir, ".cursor", "rules"), { recursive: true, force: true });
  await rm(join(sandboxDir, ".github", "instructions"), { recursive: true, force: true });
}
