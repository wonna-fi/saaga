import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Package root. Both `src/` (when running via tsx in dev) and `dist/`
 * (when running the compiled CLI) live directly under the package root,
 * so resolving "../" works in either layout.
 */
export const PACKAGE_ROOT = resolve(here, "..");

export const FLOWS_DIR = resolve(PACKAGE_ROOT, "flows");
export const PROMPTS_DIR = resolve(PACKAGE_ROOT, "prompts");
export const RULES_DIR = resolve(PACKAGE_ROOT, "rules");
