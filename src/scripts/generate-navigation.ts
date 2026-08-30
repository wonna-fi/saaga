import { readFile, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { listDocFiles } from "../docs/link-graph.js";
import {
  buildNavigation,
  GLOSSARY_FILE,
  README_FILE,
  type NavDoc,
} from "../docs/navigation.js";
import type { ScriptContext } from "./registry.js";

export interface GenerateNavigationArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Name of the documentation directory (e.g. `"saaga-docs"`). */
  docs_dir: string;
  /** Application name, used in the generated README's title. */
  app: string;
}

export interface GenerateNavigationResult {
  /** Absolute path to the written README, or `""` when nothing was written. */
  readme_path: string;
  /** Absolute path to the written glossary, or `""` when nothing was written. */
  glossary_path: string;
  indexes: number;
  rows: number;
  terms: number;
  collisions: number;
  core_concepts: number;
  /** Content defects reported through `ctx.warn`; never a failure. */
  problems: number;
}

/** Problems printed before the rest are left uncounted in the output. */
const MAX_WARNINGS = 10;

/**
 * Generates the corpus navigation layer: a reading-order `README.md` and a
 * `GLOSSARY.md`, both derived from the category INDEX files.
 *
 * The corpus has no entry point of its own and `ARCHITECTURE.md` is a graph
 * orphan — both are facts already implied by content on disk, so fixing them
 * belongs in code. Generated navigation costs no agent tokens and cannot rot
 * independently of its sources: every glossary definition is the description
 * cell of the owning INDEX row, copied verbatim. A term with no INDEX row to
 * copy from is omitted, never invented.
 *
 * Runs immediately *before* `validate-docs`, which is the opposite of what the
 * task card said. The card's own acceptance criterion — that the orphan check
 * passes on this script's output — requires the validator to see the generated
 * files, and generating first also link-validates the generator's own output,
 * so a bug here fails the run instead of shipping a broken corpus.
 *
 * Content defects only warn. Structural failure is `validate-docs`'s job; a
 * malformed INDEX row must not abort a run whose corpus is already on disk.
 */
export async function generateNavigation(
  args: GenerateNavigationArgs,
  ctx: ScriptContext,
): Promise<GenerateNavigationResult> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("generate-navigation: 'app_dir' arg is required");
  }
  const docsDir = args.docs_dir;
  if (!docsDir) {
    throw new Error("generate-navigation: 'docs_dir' arg is required");
  }
  const app = args.app;
  if (!app) {
    throw new Error("generate-navigation: 'app' arg is required");
  }

  const docsRoot = resolve(appDir, docsDir);
  const paths = await listDocFiles(docsRoot);

  // An absent or empty corpus is not a failure: every flow must stay runnable
  // against a greenfield project, exactly as `validate-docs` does.
  if (paths.length === 0) return empty();

  // `Promise.all` over a `map` preserves *input* order regardless of which
  // read finishes first — never accumulate into a shared array here.
  const docs: NavDoc[] = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(resolve(docsRoot, path), "utf8"),
    })),
  );

  const result = buildNavigation({ app, docs });

  for (const problem of result.problems.slice(0, MAX_WARNINGS)) {
    const where = posix.join(docsDir, problem.file);
    const at = problem.line === undefined ? where : `${where}:${problem.line}`;
    ctx.warn?.(`${at} — ${problem.message}`);
  }
  const hidden = result.problems.length - MAX_WARNINGS;
  if (hidden > 0) {
    ctx.warn?.(`…and ${hidden} more navigation problem(s)`);
  }

  if (result.files.length === 0) {
    ctx.warn?.(`no INDEX.md under ${docsDir}/; navigation not generated`);
    return { ...empty(), problems: result.problems.length };
  }

  for (const file of result.files) {
    await writeFile(resolve(docsRoot, file.path), file.content, "utf8");
  }

  return {
    readme_path: resolve(docsRoot, README_FILE),
    glossary_path: resolve(docsRoot, GLOSSARY_FILE),
    indexes: result.stats.indexes,
    rows: result.stats.rows,
    terms: result.stats.terms,
    collisions: result.stats.collisions,
    core_concepts: result.stats.core_concepts,
    problems: result.problems.length,
  };
}

function empty(): GenerateNavigationResult {
  return {
    readme_path: "",
    glossary_path: "",
    indexes: 0,
    rows: 0,
    terms: 0,
    collisions: 0,
    core_concepts: 0,
    problems: 0,
  };
}
