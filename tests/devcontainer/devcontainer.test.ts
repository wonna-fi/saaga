import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REWRITE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Strips comments from a JSONC string. devcontainer.json is technically
 * JSONC; `JSON.parse` would choke on the leading `//` comments we keep
 * for documentation, so we pre-process them out here.
 */
function stripJsonComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("rewrite/.devcontainer scaffold", () => {
  test("devcontainer.json parses and points postCreateCommand at install-agents.sh", async () => {
    const dcPath = resolve(REWRITE_ROOT, ".devcontainer", "devcontainer.json");
    expect(await pathExists(dcPath)).toBe(true);
    const raw = await readFile(dcPath, "utf8");
    const parsed = JSON.parse(stripJsonComments(raw)) as {
      name: string;
      postCreateCommand: string;
    };
    expect(parsed.name).toBe("saaga");
    expect(parsed.postCreateCommand).toContain(
      ".devcontainer/install-agents.sh",
    );
  });

  test("install-agents.sh exists and is an empty stub", async () => {
    const hookPath = resolve(
      REWRITE_ROOT,
      ".devcontainer",
      "install-agents.sh",
    );
    expect(await pathExists(hookPath)).toBe(true);
    const content = await readFile(hookPath, "utf8");
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(content).toMatch(/examples\/install-agents/);
  });

  test("examples/install-agents/install-cursor-agent.sh is shipped", async () => {
    const p = resolve(
      REWRITE_ROOT,
      "examples",
      "install-agents",
      "install-cursor-agent.sh",
    );
    expect(await pathExists(p)).toBe(true);
    const content = await readFile(p, "utf8");
    expect(content).toContain("cursor.com/install");
  });

  test("examples/install-agents/install-copilot.sh is shipped", async () => {
    const p = resolve(
      REWRITE_ROOT,
      "examples",
      "install-agents",
      "install-copilot.sh",
    );
    expect(await pathExists(p)).toBe(true);
    const content = await readFile(p, "utf8");
    expect(content).toContain("copilot-install");
  });

  test("examples/Dockerfile is shipped as a self-containerization example", async () => {
    const p = resolve(REWRITE_ROOT, "examples", "Dockerfile");
    expect(await pathExists(p)).toBe(true);
    const content = await readFile(p, "utf8");
    expect(content).toMatch(/FROM\s+node:/);
    expect(content).toContain("saaga");
  });
});
