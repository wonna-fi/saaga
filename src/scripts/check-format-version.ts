import { resolve } from "node:path";
import {
  CURRENT_FORMAT_VERSION,
  FORMAT_FILE,
  readFormatVersion,
} from "../docs/format-version.js";
import type { ScriptContext } from "./registry.js";

export interface CheckFormatVersionArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Name of the documentation directory (e.g. `"saaga-docs"`). */
  docs_dir: string;
  /**
   * `"init"` for flows that create a corpus, `"update"` for flows that consume
   * an existing one. The two modes disagree about what an existing corpus
   * means: `init` must not overwrite one, `update` requires one at a matching
   * version.
   */
  mode: string;
}

/**
 * First step of every flow: refuses to run a flow whose templates do not match
 * the corpus on disk.
 *
 * Without this gate an upgraded Saaga run against a pre-beta corpus fails every
 * touched document on structure alone and sends the fix loop into an unplanned
 * rewrite. Three states are resolved:
 *
 *   1. No corpus (docs dir absent or empty) — passes in both modes; `init`
 *      goes on to create and stamp the tree.
 *   2. Existing corpus, `mode: update` — passes only when the stamped version
 *      matches; a pre-beta corpus reads as version 0 and fails.
 *   3. Existing corpus, `mode: init` — always fails, so re-initialising is an
 *      explicit delete-then-init rather than a silent overwrite.
 *
 * Deliberately a gate and not a migration framework: exactly one transition
 * exists today, and its upgrade path is stated in the error message.
 */
export async function checkFormatVersion(
  args: CheckFormatVersionArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("check-format-version: 'app_dir' arg is required");
  }
  const docsDir = args.docs_dir;
  if (!docsDir) {
    throw new Error("check-format-version: 'docs_dir' arg is required");
  }
  const mode = args.mode;
  if (mode !== "init" && mode !== "update") {
    throw new Error(
      `check-format-version: 'mode' must be "init" or "update" (got ${mode ? `"${mode}"` : "no value"})`,
    );
  }

  const docsPath = resolve(appDir, docsDir);
  const found = await readFormatVersion(docsPath);

  if (found.state === "no-corpus") return;

  if (mode === "init") {
    throw new Error(
      `check-format-version: ${docsDir}/ already contains a corpus (format version ${found.version}). ` +
        `init does not overwrite an existing corpus: delete ${docsDir}/ and run 'saaga run init' again to rebuild it.`,
    );
  }

  if (found.version !== CURRENT_FORMAT_VERSION) {
    throw new Error(
      `check-format-version: ${docsDir}/ is at format version ${found.version}, but this version of Saaga writes format version ${CURRENT_FORMAT_VERSION}` +
        `${found.version === 0 ? ` (a corpus without a ${docsDir}/${FORMAT_FILE} file predates the stamp)` : ""}. ` +
        `Running update-family flows against it would fail every touched document on structure alone. ` +
        `To upgrade: delete ${docsDir}/ and run 'saaga run init' to regenerate the corpus. ` +
        `${found.version === 0 ? `A version-0 corpus is not migrated in place: the format changed what gets documented and at what depth, so regenerating gives a better base than any upgrade could. ` : ""}` +
        `(In-place migration is planned for later format versions, once the format is frozen.)`,
    );
  }
}
