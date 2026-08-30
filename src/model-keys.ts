/**
 * Model key vocabulary, kept free of backend and agent imports so the flow
 * engine can validate a step's `model:` key without pulling the concrete
 * agent backends into its module graph.
 */

/** Lowercase, starts with a letter, then any of a-z 0-9 `_` `-`. */
export const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function isValidModelKey(key: string): boolean {
  return MODEL_KEY_PATTERN.test(key);
}

/**
 * The key an agent step gets when its YAML omits `model:`. Steps are never
 * given this value at parse time — the default is applied when the step runs,
 * so that a flow omitting the key hashes the same as it did before the key
 * existed (see `flowHash()`).
 */
export const DEFAULT_MODEL_KEY = "medium";
