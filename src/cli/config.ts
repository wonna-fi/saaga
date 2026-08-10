import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Backend } from "./backend.js";

export const CONFIG_DIR = ".saaga";
export const CONFIG_FILE = "config.yaml";
export const DEFAULT_DOCS_DIR = "saaga-docs";

const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude"];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface BackendModels {
  modelLow?: string;
  modelMedium?: string;
  modelHigh?: string;
}

export interface SaagaConfig {
  defaultBackend?: string;
  backends?: Partial<Record<Backend, BackendModels>>;
  ruleTargets?: string;
  docsDir?: string;
  autoApprove?: boolean;
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

  return config;
}

function parseBackends(
  value: unknown,
): Partial<Record<Backend, BackendModels>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends' must be a YAML mapping`,
    );
  }

  const raw = value as Record<string, unknown>;
  const result: Partial<Record<Backend, BackendModels>> = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (!ALLOWED_BACKENDS.includes(key as Backend)) {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${key}' is not a valid backend (must be 'cursor', 'copilot', or 'claude')`,
      );
    }
    result[key as Backend] = parseBackendModels(key, entry);
  }

  return result;
}

function parseBackendModels(backend: string, value: unknown): BackendModels {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}' must be a YAML mapping`,
    );
  }

  const obj = value as Record<string, unknown>;
  const models: BackendModels = {};

  for (const field of ["modelLow", "modelMedium", "modelHigh"] as const) {
    if (obj[field] !== undefined) {
      if (typeof obj[field] !== "string") {
        throw new ConfigError(
          `${CONFIG_DIR}/${CONFIG_FILE}: 'backends.${backend}.${field}' must be a string`,
        );
      }
      models[field] = obj[field];
    }
  }

  return models;
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
