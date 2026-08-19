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
        "    models:",
        "      low: sonnet",
        "      medium: sonnet",
        "      high: opus",
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
          models: { low: "sonnet", medium: "sonnet", high: "opus" },
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
        "    models:",
        "      high: opus",
        "  cursor:",
        "    models:",
        "      medium: claude-4.6-sonnet-medium-thinking",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      defaultBackend: "claude",
      backends: {
        claude: { models: { high: "opus" } },
        cursor: {
          models: { medium: "claude-4.6-sonnet-medium-thinking" },
        },
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
      "backends:\n  gemini:\n    models:\n      high: x\n",
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

  test("throws ConfigError when a model value is not a string", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor:\n    models:\n      high: [opus]\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.cursor\.models\.high' must be a string/,
    );
  });

  test("rejects the removed modelLow/modelMedium/modelHigh keys", async () => {
    for (const [field, key] of [
      ["modelLow", "low"],
      ["modelMedium", "medium"],
      ["modelHigh", "high"],
    ]) {
      const dir = await tmpDir();
      await mkdir(join(dir, ".saaga"), { recursive: true });
      await writeFile(
        join(dir, ".saaga", "config.yaml"),
        `backends:\n  cursor:\n    ${field}: opus\n`,
        "utf8",
      );
      await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
      await expect(loadConfig(dir)).rejects.toThrow(
        new RegExp(
          `'backends\\.cursor\\.${field}' is no longer supported.*models\\.${key}`,
        ),
      );
    }
  });

  test("throws ConfigError when models is not a mapping", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor:\n    models: opus\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.cursor\.models' must be a YAML mapping/,
    );
  });

  test("throws ConfigError for an unknown field under a backend", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor:\n    foo: bar\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'backends\.cursor\.foo' is not a valid field \(expected 'models'\)/,
    );
  });

  test("throws ConfigError for an invalid model key", async () => {
    for (const key of ["Low", "__proto__", "my.key"]) {
      const dir = await tmpDir();
      await mkdir(join(dir, ".saaga"), { recursive: true });
      await writeFile(
        join(dir, ".saaga", "config.yaml"),
        `backends:\n  cursor:\n    models:\n      ${key}: x\n`,
        "utf8",
      );
      await expect(loadConfig(dir)).rejects.toThrow(/is not a valid model key/);
    }
  });

  test("accepts arbitrary custom model keys", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      [
        "backends:",
        "  cursor:",
        "    models:",
        "      plan: a",
        "      review_2: b",
        "      fast-triage: c",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config).toEqual({
      backends: {
        cursor: {
          models: { plan: "a", review_2: "b", "fast-triage": "c" },
        },
      },
    });
  });

  test("accepts a backend entry with no models key", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "backends:\n  cursor: {}\n",
      "utf8",
    );
    expect(await loadConfig(dir)).toEqual({ backends: { cursor: {} } });
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

  test("parses unstableFeatures array", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "unstableFeatures:\n  - none\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config.unstableFeatures).toEqual(["none"]);
  });

  test("parses empty unstableFeatures array", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "unstableFeatures: []\n",
      "utf8",
    );
    const config = await loadConfig(dir);
    expect(config.unstableFeatures).toEqual([]);
  });

  test("throws ConfigError when unstableFeatures is not an array", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "unstableFeatures: none\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /'unstableFeatures' must be an array/,
    );
  });

  test("throws ConfigError when unstableFeatures contains non-string items", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "unstableFeatures:\n  - 123\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /unstableFeatures.*must be strings/,
    );
  });

  test("throws ConfigError when unstableFeatures contains unknown feature", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".saaga"), { recursive: true });
    await writeFile(
      join(dir, ".saaga", "config.yaml"),
      "unstableFeatures:\n  - bogus\n",
      "utf8",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /unknown feature 'bogus'/,
    );
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
