import { describe, expect, test } from "vitest";
import {
  BUILTIN_MODEL_KEYS,
  BackendError,
  backendCliCommand,
  mergeModelOverrides,
  parseModelOverrides,
  resolveBackend,
  resolveModel,
  resolveModels,
} from "../../src/cli/backend.js";

describe("resolveBackend", () => {
  test("uses --backend flag", () => {
    expect(resolveBackend({ flag: "cursor" })).toBe("cursor");
    expect(resolveBackend({ flag: "copilot" })).toBe("copilot");
    expect(resolveBackend({ flag: "claude" })).toBe("claude");
  });

  test("falls back to config when no flag is given", () => {
    expect(resolveBackend({ flag: undefined, config: "copilot" })).toBe(
      "copilot",
    );
  });

  test("flag takes precedence over config", () => {
    expect(resolveBackend({ flag: "cursor", config: "copilot" })).toBe(
      "cursor",
    );
  });

  test("ignores empty config value", () => {
    expect(() => resolveBackend({ flag: undefined, config: "" })).toThrow(
      BackendError,
    );
  });

  test("rejects unknown backend value", () => {
    expect(() => resolveBackend({ flag: "gemini" })).toThrow(
      /must be 'cursor', 'copilot', or 'claude'/,
    );
  });

  test("requires a backend to be specified somewhere", () => {
    expect(() => resolveBackend({ flag: undefined })).toThrow(
      /Backend must be specified/,
    );
  });

  test("error message references .saaga/config.yaml", () => {
    expect(() => resolveBackend({})).toThrow(/\.saaga\/config\.yaml/);
  });
});

describe("parseModelOverrides", () => {
  test("returns an empty map for no entries", () => {
    expect(parseModelOverrides([])).toEqual({});
  });

  test("parses key=value pairs", () => {
    expect(parseModelOverrides(["high=opus", "medium=sonnet"])).toEqual({
      high: "opus",
      medium: "sonnet",
    });
  });

  test("keeps everything after the first '=' as the model name", () => {
    expect(parseModelOverrides(["high=vendor/model=v2"])).toEqual({
      high: "vendor/model=v2",
    });
  });

  test("trims whitespace around key and value", () => {
    expect(parseModelOverrides(["  high = opus  "])).toEqual({ high: "opus" });
  });

  test("last occurrence of a duplicate key wins", () => {
    expect(parseModelOverrides(["high=a", "high=b"])).toEqual({ high: "b" });
  });

  test("accepts digits, hyphens and underscores in keys", () => {
    expect(parseModelOverrides(["plan_v2-1=x"])).toEqual({ "plan_v2-1": "x" });
  });

  test("throws when the entry has no '='", () => {
    expect(() => parseModelOverrides(["high"])).toThrow(BackendError);
    expect(() => parseModelOverrides(["high"])).toThrow(
      /expected '<key>=<model>'/,
    );
  });

  test("throws when the key is empty", () => {
    expect(() => parseModelOverrides(["=opus"])).toThrow(
      /model key must not be empty/,
    );
  });

  test("throws when the model is empty", () => {
    expect(() => parseModelOverrides(["high="])).toThrow(
      /model must not be empty/,
    );
    expect(() => parseModelOverrides(["high=   "])).toThrow(
      /model must not be empty/,
    );
  });

  test("rejects keys that do not start with a lowercase letter", () => {
    for (const entry of ["High=x", "1low=x", "-low=x", "_low=x", "__proto__=x"]) {
      expect(() => parseModelOverrides([entry])).toThrow(BackendError);
    }
  });

  test("rejects keys with characters outside a-z0-9_-", () => {
    expect(() => parseModelOverrides(["low.tier=x"])).toThrow(BackendError);
    expect(() => parseModelOverrides(["low tier=x"])).toThrow(BackendError);
  });
});

describe("mergeModelOverrides", () => {
  test("returns an empty object when both sides are absent", () => {
    expect(mergeModelOverrides()).toEqual({});
  });

  test("returns config models when there are no CLI overrides", () => {
    expect(mergeModelOverrides({ high: "opus" })).toEqual({ high: "opus" });
  });

  test("returns CLI overrides when there is no config", () => {
    expect(mergeModelOverrides(undefined, { high: "opus" })).toEqual({
      high: "opus",
    });
  });

  test("CLI overrides win per key and leave other keys intact", () => {
    expect(
      mergeModelOverrides(
        { low: "haiku", high: "opus" },
        { high: "sonnet" },
      ),
    ).toEqual({ low: "haiku", high: "sonnet" });
  });

  test("does not mutate its inputs", () => {
    const config = { high: "opus" };
    const cli = { high: "sonnet" };
    mergeModelOverrides(config, cli);
    expect(config).toEqual({ high: "opus" });
    expect(cli).toEqual({ high: "sonnet" });
  });
});

describe("resolveModel", () => {
  test("returns built-in high defaults", () => {
    expect(resolveModel("cursor", "high")).toBe(
      "claude-4.6-opus-high-thinking",
    );
    expect(resolveModel("copilot", "high")).toBe("claude-sonnet-4.6");
    expect(resolveModel("claude", "high")).toBe("opus");
  });

  test("returns built-in medium defaults (former quick models)", () => {
    expect(resolveModel("cursor", "medium")).toBe("cursor-grok-4.5-high");
    expect(resolveModel("copilot", "medium")).toBe("claude-sonnet-4.6");
    expect(resolveModel("claude", "medium")).toBe("sonnet");
  });

  test("returns built-in low defaults (cheaper models for probes)", () => {
    expect(resolveModel("cursor", "low")).toBe("composer-2.5");
    expect(resolveModel("copilot", "low")).toBe("claude-haiku-4.5");
    expect(resolveModel("claude", "low")).toBe("haiku");
  });

  test("uses the resolved map over the built-in default", () => {
    expect(resolveModel("cursor", "high", { high: "custom-high" })).toBe(
      "custom-high",
    );
    expect(resolveModel("cursor", "medium", { medium: "custom-med" })).toBe(
      "custom-med",
    );
    expect(resolveModel("cursor", "low", { low: "custom-low" })).toBe(
      "custom-low",
    );
  });

  test("falls back to defaults when the key is absent from the map", () => {
    expect(resolveModel("claude", "high", { low: "haiku" })).toBe("opus");
  });

  test("treats empty values as absent", () => {
    expect(resolveModel("claude", "high", { high: "" })).toBe("opus");
  });

  test("resolves a custom key that only exists in the map", () => {
    expect(resolveModel("claude", "plan", { plan: "opus" })).toBe("opus");
  });

  test("throws naming the key, the backend and the available keys", () => {
    expect(() => resolveModel("claude", "plan")).toThrow(BackendError);
    expect(() => resolveModel("claude", "plan")).toThrow(
      /Unknown model key 'plan'/,
    );
    expect(() => resolveModel("claude", "plan")).toThrow(/backend 'claude'/);
    expect(() => resolveModel("claude", "plan")).toThrow(/low, medium, high/);
  });

  test("lists custom map keys among the available keys", () => {
    expect(() => resolveModel("claude", "nope", { plan: "opus" })).toThrow(
      /low, medium, high, plan/,
    );
  });

  test("does not resolve inherited Object.prototype keys", () => {
    expect(() => resolveModel("claude", "constructor", {})).toThrow(
      BackendError,
    );
  });
});

describe("BUILTIN_MODEL_KEYS", () => {
  test("exposes low, medium and high", () => {
    expect(BUILTIN_MODEL_KEYS).toEqual(["low", "medium", "high"]);
  });
});

describe("backendCliCommand", () => {
  test("returns the CLI binary each backend executes", () => {
    expect(backendCliCommand("cursor")).toBe("cursor-agent");
    expect(backendCliCommand("copilot")).toBe("copilot");
    expect(backendCliCommand("claude")).toBe("claude");
  });
});

describe("resolveModels", () => {
  test("resolves every key a flow asks for", () => {
    expect(resolveModels("claude", ["medium", "high"])).toEqual({
      medium: "sonnet",
      high: "opus",
    });
  });

  test("deduplicates repeated keys", () => {
    expect(resolveModels("claude", ["high", "high", "high"])).toEqual({
      high: "opus",
    });
  });

  test("applies overrides per key", () => {
    expect(
      resolveModels("claude", ["low", "high"], { high: "custom" }),
    ).toEqual({ low: "haiku", high: "custom" });
  });

  test("an empty key list resolves to an empty map", () => {
    expect(resolveModels("claude", [])).toEqual({});
  });

  test("a custom key resolves when configured", () => {
    expect(resolveModels("claude", ["triage"], { triage: "haiku" })).toEqual({
      triage: "haiku",
    });
  });

  /** Fails before the run starts rather than part-way through a flow. */
  test("throws for a key with no model behind it", () => {
    expect(() => resolveModels("claude", ["medium", "triage"])).toThrow(
      BackendError,
    );
    expect(() => resolveModels("claude", ["medium", "triage"])).toThrow(
      "Unknown model key 'triage'",
    );
  });
});
