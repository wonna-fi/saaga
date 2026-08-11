import { describe, expect, test } from "vitest";
import {
  BackendError,
  backendCliCommand,
  resolveBackend,
  resolveModelForTier,
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

describe("resolveModelForTier", () => {
  test("returns built-in high defaults", () => {
    expect(resolveModelForTier("cursor", "high")).toBe(
      "claude-4.6-opus-high-thinking",
    );
    expect(resolveModelForTier("copilot", "high")).toBe("claude-sonnet-4.6");
    expect(resolveModelForTier("claude", "high")).toBe("opus");
  });

  test("returns built-in medium defaults (former quick models)", () => {
    expect(resolveModelForTier("cursor", "medium")).toBe(
      "cursor-grok-4.5-high",
    );
    expect(resolveModelForTier("copilot", "medium")).toBe("claude-sonnet-4.6");
    expect(resolveModelForTier("claude", "medium")).toBe("sonnet");
  });

  test("returns built-in low defaults (cheaper models for probes)", () => {
    expect(resolveModelForTier("cursor", "low")).toBe("composer-2.5");
    expect(resolveModelForTier("copilot", "low")).toBe("claude-haiku-4.5");
    expect(resolveModelForTier("claude", "low")).toBe("haiku");
  });

  test("uses config override for the requested tier", () => {
    expect(
      resolveModelForTier("cursor", "high", { modelHigh: "custom-high" }),
    ).toBe("custom-high");
    expect(
      resolveModelForTier("cursor", "medium", { modelMedium: "custom-med" }),
    ).toBe("custom-med");
    expect(
      resolveModelForTier("cursor", "low", { modelLow: "custom-low" }),
    ).toBe("custom-low");
  });

  test("falls back to defaults when config tier is absent", () => {
    expect(resolveModelForTier("claude", "high", { modelLow: "haiku" })).toBe(
      "opus",
    );
  });

  test("treats empty config values as absent", () => {
    expect(resolveModelForTier("claude", "high", { modelHigh: "" })).toBe(
      "opus",
    );
  });
});

describe("backendCliCommand", () => {
  test("returns the CLI binary each backend executes", () => {
    expect(backendCliCommand("cursor")).toBe("cursor-agent");
    expect(backendCliCommand("copilot")).toBe("copilot");
    expect(backendCliCommand("claude")).toBe("claude");
  });
});
