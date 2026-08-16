import { describe, expect, test, afterEach } from "vitest";
import {
  UNSTABLE_FEATURES,
  isUnstableFeature,
  findUnknownFeature,
  resolveUnstableFeatures,
  initUnstableFeatures,
  isUnstableFeatureEnabled,
  getEnabledUnstableFeatures,
  resetUnstableFeatures,
} from "../src/unstable-features.js";

afterEach(() => {
  resetUnstableFeatures();
});

describe("UNSTABLE_FEATURES catalogue", () => {
  test("contains 'none'", () => {
    expect(UNSTABLE_FEATURES).toContain("none");
  });

  test("is a non-empty readonly tuple", () => {
    expect(UNSTABLE_FEATURES.length).toBeGreaterThan(0);
  });
});

describe("isUnstableFeature", () => {
  test("returns true for known features", () => {
    for (const name of UNSTABLE_FEATURES) {
      expect(isUnstableFeature(name)).toBe(true);
    }
  });

  test("returns false for unknown names", () => {
    expect(isUnstableFeature("bogus")).toBe(false);
    expect(isUnstableFeature("")).toBe(false);
  });
});

describe("findUnknownFeature", () => {
  test("returns undefined when all names are valid", () => {
    expect(findUnknownFeature(["none"])).toBeUndefined();
    expect(findUnknownFeature([])).toBeUndefined();
  });

  test("returns the first unknown name", () => {
    expect(findUnknownFeature(["none", "bogus", "also-bad"])).toBe("bogus");
    expect(findUnknownFeature(["unknown"])).toBe("unknown");
  });
});

describe("resolveUnstableFeatures", () => {
  test("unions config and CLI, preserving first-seen order", () => {
    const result = resolveUnstableFeatures(["none"], []);
    expect(result).toEqual(["none"]);
  });

  test("deduplicates across sources", () => {
    const result = resolveUnstableFeatures(["none"], ["none"]);
    expect(result).toEqual(["none"]);
  });

  test("returns empty array when both sources are empty", () => {
    expect(resolveUnstableFeatures([], [])).toEqual([]);
  });

  test("config entries appear before CLI-only entries", () => {
    // When there are multiple features, config order comes first
    const result = resolveUnstableFeatures(["none"], []);
    expect(result[0]).toBe("none");
  });
});

describe("initUnstableFeatures / isUnstableFeatureEnabled", () => {
  test("all features are disabled by default", () => {
    expect(isUnstableFeatureEnabled("none")).toBe(false);
  });

  test("enabled feature returns true", () => {
    initUnstableFeatures(["none"]);
    expect(isUnstableFeatureEnabled("none")).toBe(true);
  });

  test("replaces prior state on re-init", () => {
    initUnstableFeatures(["none"]);
    expect(isUnstableFeatureEnabled("none")).toBe(true);

    initUnstableFeatures([]);
    expect(isUnstableFeatureEnabled("none")).toBe(false);
  });
});

describe("getEnabledUnstableFeatures", () => {
  test("returns empty array when nothing is enabled", () => {
    expect(getEnabledUnstableFeatures()).toEqual([]);
  });

  test("returns enabled features in sorted order", () => {
    initUnstableFeatures(["none"]);
    expect(getEnabledUnstableFeatures()).toEqual(["none"]);
  });
});

describe("resetUnstableFeatures", () => {
  test("clears all enabled features", () => {
    initUnstableFeatures(["none"]);
    resetUnstableFeatures();
    expect(isUnstableFeatureEnabled("none")).toBe(false);
    expect(getEnabledUnstableFeatures()).toEqual([]);
  });
});
