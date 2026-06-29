import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const CONFIG_DIR = ".saaga";
export const CONFIG_FILE = "config.yaml";
export const DEFAULT_DOCS_DIR = "saaga-docs";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface SaagaConfig {
  backend?: string;
  model?: string;
  quickModel?: string;
  ruleTargets?: string;
  docsDir?: string;
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

  if (obj.backend !== undefined) {
    if (typeof obj.backend !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'backend' must be a string`,
      );
    }
    config.backend = obj.backend;
  }

  if (obj.model !== undefined) {
    if (typeof obj.model !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'model' must be a string`,
      );
    }
    config.model = obj.model;
  }

  if (obj.quickModel !== undefined) {
    if (typeof obj.quickModel !== "string") {
      throw new ConfigError(
        `${CONFIG_DIR}/${CONFIG_FILE}: 'quickModel' must be a string`,
      );
    }
    config.quickModel = obj.quickModel;
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

  return config;
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
