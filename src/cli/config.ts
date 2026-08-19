import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { type Backend, isValidModelKey } from "./backend.js";
import { UNSTABLE_FEATURES, isUnstableFeature } from "../unstable-features.js";

const UNSTABLE_FEATURES_LIST = UNSTABLE_FEATURES.join(", ");

export const CONFIG_DIR = ".saaga";
export const CONFIG_FILE = "config.yaml";
export const DEFAULT_DOCS_DIR = "saaga-docs";

const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude"];

/** Removed fields, mapped to the model key that replaced them. */
const LEGACY_MODEL_FIELDS: Record<string, string> = {
  modelLow: "low",
  modelMedium: "medium",
  modelHigh: "high",
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface BackendConfig {
  /** Model key -> model name. Keys are free-form; see `MODEL_KEY_PATTERN`. */
  models?: Record<string, string>;
}

export interface SaagaConfig {
  defaultBackend?: string;
  backends?: Partial<Record<Backend, BackendConfig>>;
  ruleTargets?: string;
  docsDir?: string;
  autoApprove?: boolean;
  unstableFeatures?: string[];
}

/**
 * Loads the project config from `<projectDir>/.saaga/config.yaml`.
 * Returns an empty object when the file does not exist.
 * Throws `ConfigError` on malformed YAML or invalid field types.
 */
export async function loadConfig(projectDir: string): Promise<SaagaConfig> {
  const configPath = resolve(projectDir, CONFIG_DIR, CONFIG_FILE);

  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse ${CONFIG_DIR}/${CONFIG_FILE}: ${(err as Error).message}`,
    );
  }

  if (raw === null || raw === undefined) {
    return {};
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE} must be a YAML mapping, got ${Array.isArray(raw) ? "array" : typeof raw}`,
    );
  }

  const obj = raw as Record<string, unknown>;
  const config: SaagaConfig = {};

  if (obj.defaultBackend !== undefined) {
    if (typeof obj.defaultBackend !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'defaultBackend' must be a string`,
      );
    }
    config.defaultBackend = obj.defaultBackend;
  }

  if (obj.backends !== undefined) {
    config.backends = parseBackends(obj.backends);
  }

  if (obj.ruleTargets !== undefined) {
    config.ruleTargets = normalizeRuleTargets(obj.ruleTargets);
  }

  if (obj.docsDir !== undefined) {
    if (typeof obj.docsDir !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'docsDir' must be a string`,
      );
    }
    config.docsDir = obj.docsDir;
  }

  if (obj.autoApprove !== undefined) {
    if (typeof obj.autoApprove !== "boolean") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'autoApprove' must be a boolean`,
      );
    }
    config.autoApprove = obj.autoApprove;
  }

  if (obj.unstableFeatures !== undefined) {
    config.unstableFeatures = parseUnstableFeatures(obj.unstableFeatures);
  }

  return config;
}

function parseBackends(
  value: unknown,
): Partial<Record<Backend, BackendConfig>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends' must be a YAML mapping`,
    );
  }

  const raw = value as Record<string, unknown>;
  const result: Partial<Record<Backend, BackendConfig>> = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (!ALLOWED_BACKENDS.includes(key as Backend)) {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${key}' is not a valid backend (must be 'cursor', 'copilot', or 'claude')`,
      );
    }
    result[key as Backend] = parseBackendConfig(key, entry);
  }

  return result;
}

function parseBackendConfig(backend: string, value: unknown): BackendConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}' must be a YAML mapping`,
    );
  }

  const obj = value as Record<string, unknown>;
  const config: BackendConfig = {};

  for (const key of Object.keys(obj)) {
    if (key === "models") {
      continue;
    }
    // Check the removed fields first, so a stale config gets the migration
    // hint rather than a generic unknown-field error.
    const replacement = LEGACY_MODEL_FIELDS[key];
    if (replacement !== undefined) {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.${key}' is no longer supported — use 'backends.${backend}.models.${replacement}' instead`,
      );
    }
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.${key}' is not a valid field (expected 'models')`,
    );
  }

  if (obj.models !== undefined) {
    config.models = parseModelsMap(backend, obj.models);
  }

  return config;
}

function parseModelsMap(
  backend: string,
  value: unknown,
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.models' must be a YAML mapping`,
    );
  }

  const raw = value as Record<string, unknown>;
  const models: Record<string, string> = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (!isValidModelKey(key)) {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.models.${key}' is not a valid model key (keys must be lowercase and start with a letter; allowed: a-z, 0-9, '-', '_')`,
      );
    }
    if (typeof entry !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.models.${key}' must be a string`,
      );
    }
    models[key] = entry;
  }

  return models;
}

function parseUnstableFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'unstableFeatures' must be an array of strings`,
    );
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'unstableFeatures' array items must be strings`,
      );
    }
    if (!isUnstableFeature(item)) {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'unstableFeatures' contains unknown feature '${item}' (available: ${UNSTABLE_FEATURES_LIST})`,
      );
    }
  }
  return value as string[];
}

/**
 * Normalizes ruleTargets: accepts a YAML list of strings or a
 * comma-separated string, and returns a comma-separated string
 * suitable for `parseRuleTargets()`.
 */
function normalizeRuleTargets(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") {
        throw new ConfigError(
          `${CONFIG_DIR}/${CONFIG_FILE}: 'ruleTargets' array items must be strings`,
        );
      }
    }
    return (value as string[]).join(",");
  }
  throw new ConfigError(
    `${CONFIG_DIR}/${CONFIG_FILE}: 'ruleTargets' must be a string or array of strings`,
  );
}
