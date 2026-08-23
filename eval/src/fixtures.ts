import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Build a prepare() that overwrites one sandbox file with a committed stub
 * fixture. Fixtures are whole-file copies with function bodies replaced by
 * `throw new Error("not implemented")` — exports and types survive, so the
 * target tests fail on behavior (not import resolution) and the agent gets
 * the signatures as scaffolding. Whole-file replacement is immune to
 * internal drift of the real file; renames/export changes are caught by
 * the drift-guard test (eval/code-tasks.test.ts).
 *
 * The fixture is read host-side (prepare runs before the sandbox commit;
 * eval/ is stripped from the sandbox but not from the host).
 */
export function stubWith(fixtureUrl: URL, targetRel: string) {
  return async (sandboxDir: string): Promise<void> => {
    const stub = await readFile(fileURLToPath(fixtureUrl), "utf8");
    await writeFile(join(sandboxDir, targetRel), stub);
  };
}
