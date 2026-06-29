import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ConfigError, loadConfig } from "../../src/cli/config.js";

async function tmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "saaga-config-"));
}

describe("loadConfig", () => {
  test("returns empty object when .saaga/config.yaml does not exist", async () => {
    const dir = await tmpDir();
    const config = await loadConfig(dir);
    expect(config).toEqual({});
  });

  test("returns empty object for an empty YAML file", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(join(dir, ".saaga", "config.yaml"), "", "utf8");
    const config = await loadConfig(dir);
    expect(config).toEqual({});
  });

  test("parses a fully-specified config", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backend: cursor\nmodel: opus\nquickModel: sonnet\nruleTargets: agentsmd,cursor\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      backend: "cursor",
      model: "opus",
      quickModel: "sonnet",
      ruleTargets: "agentsmd,cursor",
    });
  });

  test("normalizes ruleTargets YAML list to comma string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "ruleTargets:\n  - agentsmd\n  - claude\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config.ruleTargets).toBe("agentsmd,claude");
  });

  test("throws ConfigError on malformed YAML", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backend: [\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
  });

  test("throws ConfigError when top-level is not a mapping", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "- item1\n- item2\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/must be a YAML mapping/);
  });

  test("throws ConfigError when backend is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backend: 123\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/'backend' must be a string/);
  });

  test("throws ConfigError when model is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "model: [opus]\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/'model' must be a string/);
  });

  test("throws ConfigError when ruleTargets has non-string items", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "ruleTargets:\n  - 123\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /ruleTargets.*must be strings/,
    );
  });

  test("parses docsDir config option", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "docsDir: docs\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({ docsDir: "docs" });
  });

  test("throws ConfigError when docsDir is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "docsDir: 123\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/'docsDir' must be a string/);
  });

  test("ignores unknown keys (forward-compat)", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backend: claude\nfutureField: hello\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({ backend: "claude" });
  });
});
