import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { basename, join } from "node:path";
import ignore, { type Ignore } from "ignore";

export interface FileEntry {
  hash: string;
  path: string;
}

/**
 * Compute a git-compatible blob hash for a buffer.
 * Format: SHA-1 of `"blob <byteLength>\0<bytes>"`.
 */
export function gitBlobHash(buf: Buffer): string {
  const header = `blob ${buf.length}\0`;
  return createHash("sha1").update(header).update(buf).digest("hex");
}

interface IgnoreLayer {
  /** POSIX dir path relative to appDir ("" for root). */
  base: string;
  ig: Ignore;
}

/**
 * Walk `appDir` recursively, apply `.gitignore` + `.saagaignore` exclusion
 * rules at every directory level, and return a sorted manifest of
 * `{ hash, path }` entries for every in-scope file.
 *
 * Nested `.gitignore` and `.saagaignore` files are honoured with git's
 * "deepest match wins" semantics: the deepest ignore file whose patterns
 * have an opinion (ignore or un-ignore) about a path determines the
 * outcome.
 *
 * Hard-excluded (regardless of ignore files):
 *   - `.git/`   (top-level only)
 *   - `docs/`   (top-level only)
 *   - any file named `.saagaignore` (at any depth)
 *
 * Regular files and symlinks are included; symlinks are hashed git-style
 * (the hash of their link target, never followed). Paths are
 * POSIX-normalized relative to `appDir`.
 */
export async function computeManifest(appDir: string): Promise<FileEntry[]> {
  const files: string[] = [];
  await walk(appDir, "", [], files);
  files.sort();

  const entries: FileEntry[] = [];
  for (const rel of files) {
    const abs = join(appDir, rel);
    // Match git: a symlink is stored as a blob of its target path, never
    // dereferenced. Following it would hash the target's content (or throw
    // for a broken/dir symlink), diverging from git and the old
    // `git hash-object` behavior.
    const stats = await lstat(abs);
    const buf = stats.isSymbolicLink()
      ? Buffer.from(await readlink(abs))
      : await readFile(abs);
    entries.push({ hash: gitBlobHash(buf), path: rel });
  }
  return entries;
}

/**
 * Read `.gitignore` and `.saagaignore` from `absDir` and return an
 * `IgnoreLayer` if either file exists (patterns merged into one matcher
 * with `.gitignore` first so co-located `.saagaignore` can override).
 */
async function readDirIgnores(
  absDir: string,
  base: string,
): Promise<IgnoreLayer | null> {
  const gitignoreContent = await readFileIfExists(join(absDir, ".gitignore"));
  const saagaignoreContent = await readFileIfExists(join(absDir, ".saagaignore"));

  if (gitignoreContent === null && saagaignoreContent === null) return null;

  const ig = ignore();
  if (gitignoreContent !== null) ig.add(gitignoreContent);
  if (saagaignoreContent !== null) ig.add(saagaignoreContent);
  return { base, ig };
}

async function walk(
  root: string,
  dir: string,
  parentChain: IgnoreLayer[],
  out: string[],
): Promise<void> {
  const abs = dir ? join(root, dir) : root;

  const layer = await readDirIgnores(abs, dir);
  const chain = layer ? [...parentChain, layer] : parentChain;

  const entries = await readdir(abs, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = dir ? `${dir}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();

    if (isHardExcluded(relPath, isDir)) continue;
    if (isIgnoredByChain(chain, relPath, isDir)) continue;

    if (isDir) {
      await walk(root, relPath, chain, out);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // Symlinks are treated as files (git stores them as blobs and never
      // traverses symlinked directories).
      out.push(relPath);
    }
  }
}

/**
 * Evaluate the ignore chain shallow-to-deep. Each matcher is tested with
 * the path **relative to its own base**. The deepest matcher that has an
 * opinion (ignored or explicitly un-ignored) determines the outcome.
 */
function isIgnoredByChain(
  chain: IgnoreLayer[],
  relPath: string,
  isDir: boolean,
): boolean {
  let verdict = false;
  const suffix = isDir ? "/" : "";
  for (const { base, ig } of chain) {
    const sub = base ? relPath.slice(base.length + 1) : relPath;
    const r = ig.test(sub + suffix);
    if (r.ignored || r.unignored) verdict = r.ignored;
  }
  return verdict;
}

function isHardExcluded(relPath: string, isDir: boolean): boolean {
  if (isDir) {
    const top = relPath.split("/")[0];
    if (top === ".git" || top === "docs") return true;
  }
  if (basename(relPath) === ".saagaignore") return true;
  return false;
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Check whether a path still exists on disk as a manifest-eligible entry
 * (a regular file or a symlink), used by detect-changes to distinguish
 * `truly_deleted` from `newly_ignored`. Uses `lstat` so a directory that
 * replaced a baseline file counts as deleted (not "still present"), and a
 * symlink is reported as present without being followed.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}
