import type { Scope } from "./types.js";

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// First segment must be a valid identifier (scope variable name);
// subsequent segments can be identifiers or numeric array indices,
// e.g. `phases.0.title` reads index 0 of the phases array, then .title.
const PATH_RE_SOURCE =
  "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z0-9_]+)*";
const INTERP_RE = new RegExp("\\$\\{(" + PATH_RE_SOURCE + ")\\}", "g");
const SOLE_EXPR_RE = new RegExp("^\\$\\{(" + PATH_RE_SOURCE + ")\\}$");

/**
 * Substitutes every `${name}` and `${name.field}` reference in `template`
 * with its scope value, coercing the result to a string. For `${a.b}`,
 * `a` must resolve to an object and `b` is read from it.
 *
 * Throws `ExpressionError` if any referenced path is undefined.
 */
export function interpolate(template: string, scope: Scope): string {
  return template.replace(INTERP_RE, (_match, path: string) => {
    const value = resolvePath(path, scope);
    return value == null ? "" : String(value);
  });
}

/**
 * If `expr` consists of exactly one `${...}` reference, returns the raw
 * value (preserving arrays/objects/numbers). Otherwise interpolates and
 * returns a string.
 *
 * Use this for fields like `foreach.in` that need to receive an array.
 */
export function resolveValue(expr: string, scope: Scope): unknown {
  const match = SOLE_EXPR_RE.exec(expr);
  if (match) {
    return resolvePath(match[1], scope);
  }
  return interpolate(expr, scope);
}

function resolvePath(path: string, scope: Scope): unknown {
  const parts = path.split(".");
  let current: unknown = scope;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current == null || typeof current !== "object") {
      throw new ExpressionError(
        `Cannot read property '${part}' of '${String(current)}' in expression '${path}'`,
      );
    }
    const obj = current as Record<string, unknown>;
    if (!(part in obj)) {
      throw new ExpressionError(`Undefined variable: ${path}`);
    }
    current = obj[part];
  }
  return current;
}

const PREDICATE_RE = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;

/**
 * Evaluates a predicate expression used in `when:` and `until:` clauses.
 *
 * Supported forms:
 *   - `<lhs> <op> <rhs>` where op is one of `== != < > <= >=`
 *   - bare `${expr}` (truthy check)
 *
 * Operands may be:
 *   - `${var}` or `${var.field}` — resolved from the scope
 *   - `"quoted"` or `'quoted'` string literal
 *   - integer / float literal
 *   - bare word (treated as a string literal)
 *
 * `==` and `!=` compare via string coercion so `${phase.number} != 0`
 * works when `number` was parsed from YAML as a JS number.
 */
export function evaluatePredicate(expr: string, scope: Scope): boolean {
  const trimmed = expr.trim();
  const match = PREDICATE_RE.exec(trimmed);
  if (match) {
    const [, lhsStr, op, rhsStr] = match;
    const lhs = parseOperand(lhsStr.trim(), scope);
    const rhs = parseOperand(rhsStr.trim(), scope);
    return compare(lhs, op, rhs);
  }
  return Boolean(resolveValue(trimmed, scope));
}

function parseOperand(operand: string, scope: Scope): unknown {
  if (operand.startsWith("${")) {
    return resolveValue(operand, scope);
  }
  if (
    (operand.startsWith('"') && operand.endsWith('"')) ||
    (operand.startsWith("'") && operand.endsWith("'"))
  ) {
    return operand.slice(1, -1);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(operand)) {
    return Number(operand);
  }
  return operand;
}

function compare(lhs: unknown, op: string, rhs: unknown): boolean {
  if (op === "==" || op === "!=") {
    const ls = lhs == null ? "" : String(lhs);
    const rs = rhs == null ? "" : String(rhs);
    return op === "==" ? ls === rs : ls !== rs;
  }
  const ln = Number(lhs);
  const rn = Number(rhs);
  switch (op) {
    case "<":
      return ln < rn;
    case ">":
      return ln > rn;
    case "<=":
      return ln <= rn;
    case ">=":
      return ln >= rn;
  }
  throw new ExpressionError(`Unknown operator: ${op}`);
}
