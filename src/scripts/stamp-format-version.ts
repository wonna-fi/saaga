import { resolve } from "node:path";
import { writeFormatVersion } from "../docs/format-version.js";
import type { ScriptContext } from "./registry.js";

export interface StampFormatVersionArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Name of the documentation directory (e.g. `"saaga-docs"`). */
  docs_dir: string;
}

/**
 * Writes the format stamp onto a freshly generated corpus. Only `init` runs
 * this: the update-family flows already proved a matching stamp exists when
 * their gate passed.
 */
export async function stampFormatVersion(
  args: StampFormatVersionArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("stamp-format-version: 'app_dir' arg is required");
  }
  const docsDir = args.docs_dir;
  if (!docsDir) {
    throw new Error("stamp-format-version: 'docs_dir' arg is required");
  }

  await writeFormatVersion(resolve(appDir, docsDir));
}
