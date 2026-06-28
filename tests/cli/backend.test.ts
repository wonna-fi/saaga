import { describe, expect, test } from "vitest";
import {
  BackendError,
  defaultModelFor,
  defaultQuickModelFor,
  resolveBackend,
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

describe("defaultModelFor", () => {
  test("returns cursor default", () => {
    expect(defaultModelFor("cursor")).toBe("claude-4.6-opus-high-thinking");
  });
  test("returns copilot default", () => {
    expect(defaultModelFor("copilot")).toBe("claude-sonnet-4.5");
  });
  test("returns claude default", () => {
    expect(defaultModelFor("claude")).toBe("opus");
  });
});

describe("defaultQuickModelFor", () => {
  test("returns a cheaper cursor model", () => {
    expect(defaultQuickModelFor("cursor")).toBe(
      "claude-4.6-sonnet-medium-thinking",
    );
  });
  test("returns copilot quick default", () => {
    expect(defaultQuickModelFor("copilot")).toBe("claude-sonnet-4.5");
  });
  test("returns claude quick default", () => {
    expect(defaultQuickModelFor("claude")).toBe("sonnet");
  });
});
