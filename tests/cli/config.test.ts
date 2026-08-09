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
      [
        "defaultBackend: cursor",
        "backends:",
        "  cursor:",
        "    modelLow: sonnet",
        "    modelMedium: sonnet",
        "    modelHigh: opus",
        "ruleTargets: agentsmd,cursor",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      defaultBackend: "cursor",
      backends: {
        cursor: {
          modelLow: "sonnet",
          modelMedium: "sonnet",
          modelHigh: "opus",
        },
      },
      ruleTargets: "agentsmd,cursor",
    });
  });

  test("parses partial backend model overrides", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      [
        "defaultBackend: claude",
        "backends:",
        "  claude:",
        "    modelHigh: opus",
        "  cursor:",
        "    modelMedium: claude-4.6-sonnet-medium-thinking",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      defaultBackend: "claude",
      backends: {
        claude: { modelHigh: "opus" },
        cursor: { modelMedium: "claude-4.6-sonnet-medium-thinking" },
      },
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
      "defaultBackend: [\n",
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

  test("throws ConfigError when defaultBackend is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "defaultBackend: 123\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'defaultBackend' must be a string/,
    );
  });

  test("throws ConfigError when backends is not a mapping", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends: [cursor]\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends' must be a YAML mapping/,
    );
  });

  test("throws ConfigError for unknown backend key", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  gemini:\n    modelHigh: x\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.gemini' is not a valid backend/,
    );
  });

  test("throws ConfigError when a backend entry is not a mapping", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor: opus\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.cursor' must be a YAML mapping/,
    );
  });

  test("throws ConfigError when modelHigh is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor:\n    modelHigh: [opus]\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.cursor\.modelHigh' must be a string/,
    );
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

  test("parses autoApprove config option", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "autoApprove: true\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({ autoApprove: true });
  });

  test("throws ConfigError when autoApprove is not a boolean", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "autoApprove: sure\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'autoApprove' must be a boolean/,
    );
  });

  test("ignores unknown keys (forward-compat)", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "defaultBackend: claude\nfutureField: hello\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({ defaultBackend: "claude" });
  });

  test("ignores legacy backend/model/quickModel keys", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backend: cursor\nmodel: opus\nquickModel: sonnet\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({});
  });
});
