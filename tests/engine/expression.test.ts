import { describe, expect, test } from "vitest";
import {
  ExpressionError,
  evaluatePredicate,
  interpolate,
  resolveValue,
} from "../../src/engine/expression.js";

describe("interpolate", () => {
  test("substitutes ${var}", () => {
    expect(interpolate("Hi ${name}", { name: "Ada" })).toBe("Hi Ada");
  });

  test("substitutes ${a.b} for nested fields", () => {
    expect(interpolate("phase=${p.number}", { p: { number: 3 } })).toBe(
      "phase=3",
    );
  });

  test("substitutes multiple expressions in one string", () => {
    expect(
      interpolate("${a}/${b}", { a: "left", b: "right" }),
    ).toBe("left/right");
  });

  test("throws when the variable is undefined", () => {
    expect(() => interpolate("Hi ${x}", {})).toThrow(ExpressionError);
  });
});

describe("resolveValue", () => {
  test("returns the raw value for a sole ${var}", () => {
    const phases = [{ number: 0 }];
    expect(resolveValue("${phases}", { phases })).toBe(phases);
  });

  test("interpolates and returns a string for compound templates", () => {
    expect(resolveValue("a-${x}-b", { x: "1" })).toBe("a-1-b");
  });
});

describe("evaluatePredicate", () => {
  test("equality: ${var} == 0", () => {
    expect(evaluatePredicate("${n} == 0", { n: 0 })).toBe(true);
    expect(evaluatePredicate("${n} == 0", { n: 1 })).toBe(false);
  });

  test("inequality: ${phase.number} != 0", () => {
    expect(
      evaluatePredicate("${phase.number} != 0", { phase: { number: 1 } }),
    ).toBe(true);
    expect(
      evaluatePredicate("${phase.number} != 0", { phase: { number: 0 } }),
    ).toBe(false);
  });

  test("string literal comparison: ${status} == \"PASS\"", () => {
    expect(
      evaluatePredicate('${status} == "PASS"', { status: "PASS" }),
    ).toBe(true);
    expect(
      evaluatePredicate('${status} == "PASS"', { status: "FAIL" }),
    ).toBe(false);
  });

  test("less-than comparison", () => {
    expect(evaluatePredicate("${i} < 3", { i: 2 })).toBe(true);
    expect(evaluatePredicate("${i} < 3", { i: 3 })).toBe(false);
  });
});
