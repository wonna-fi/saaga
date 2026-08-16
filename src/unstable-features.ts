/**
 * Typed registry of unstable features.
 *
 * Every available unstable feature name lives in UNSTABLE_FEATURES.
 * The process-wide enabled set is initialized once per CLI invocation
 * via `initUnstableFeatures()` and queried anywhere via
 * `isUnstableFeatureEnabled()`.
 */

export const UNSTABLE_FEATURES = ["none"] as const;

export type UnstableFeature = (typeof UNSTABLE_FEATURES)[number];

let enabledFeatures: ReadonlySet<UnstableFeature> = new Set();

export function isUnstableFeature(name: string): name is UnstableFeature {
  return (UNSTABLE_FEATURES as readonly string[]).includes(name);
}

/**
 * Validates that every name in `names` is a known unstable feature.
 * Returns the first unknown name, or `undefined` when all are valid.
 */
export function findUnknownFeature(names: readonly string[]): string | undefined {
  return names.find((n) => !isUnstableFeature(n));
}

/**
 * Unions config and CLI feature names, deduplicates, and preserves
 * first-seen order (config entries first, then CLI additions).
 */
export function resolveUnstableFeatures(
  configFeatures: readonly string[],
  cliFeatures: readonly string[],
): UnstableFeature[] {
  const seen = new Set<string>();
  const result: UnstableFeature[] = [];
  for (const name of [...configFeatures, ...cliFeatures]) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name as UnstableFeature);
    }
  }
  return result;
}

/**
 * Replaces the process-wide enabled set. Safe to call multiple times
 * (e.g. across repeated `runCli()` calls in test processes).
 */
export function initUnstableFeatures(features: readonly UnstableFeature[]): void {
  enabledFeatures = new Set(features);
}

export function isUnstableFeatureEnabled(feature: UnstableFeature): boolean {
  return enabledFeatures.has(feature);
}

/**
 * Returns the currently enabled features as a sorted array.
 * Deterministic order for warning output.
 */
export function getEnabledUnstableFeatures(): UnstableFeature[] {
  return [...enabledFeatures].sort();
}

/**
 * Resets the registry to its initial empty state.
 * Intended for test isolation only.
 */
export function resetUnstableFeatures(): void {
  enabledFeatures = new Set();
}
