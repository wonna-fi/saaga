import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { applyCondition, type ApplyConditionOptions } from "./conditions.js";
import type { ConditionId } from "./types.js";

/**
 * An isolated copy of the repo for one agent run.
 *
 * Built from `git archive` (tracked tree only, symlinks preserved) and
 * re-initialized as a fresh single-commit repository. A plain clone or
 * worktree would carry full history, and the restricted shell profile
 * allows read-only git — an agent in the no-docs arm could recover the
 * deleted corpus with `git show`. One synthetic commit closes that leak,
 * and mutating BEFORE the commit keeps deletions out of `git status` too.
 */
export interface Sandbox {
  sandboxDir: string;
  /** Run directory for agent logs, under <sandbox>/.saaga-runs/<runId>. */
  runDir: string;
  runId: string;
  cleanup: () => Promise<void>;
}

export interface CreateSandboxOptions extends ApplyConditionOptions {
  /** Repo to export; the host Saaga checkout in real runs. */
  repoRoot: string;
  /** Full SHA (or any rev) to export the tracked tree from. */
  rev: string;
  condition: ConditionId;
  /**
   * Task-specific tree mutation, run after the condition mutation and
   * before the initial commit — it lands inside the single synthetic
   * commit, so git status/log/show reveal nothing about it.
   */
  prepare?: (sandboxDir: string) => Promise<void>;
}

export async function createSandbox(opts: CreateSandboxOptions): Promise<Sandbox> {
  const base = await mkdtemp(join(tmpdir(), "saaga-eval-"));
  const sandboxDir = join(base, "repo");
  await mkdir(sandboxDir, { recursive: true });

  try {
    const tarFile = join(base, "export.tar");
    await execa("git", ["-C", opts.repoRoot, "archive", "--format=tar", "-o", tarFile, opts.rev]);
    await execa("tar", ["-xf", tarFile, "-C", sandboxDir]);
    await rm(tarFile, { force: true });

    // Answer-key material never reaches an agent: eval/ holds the task
    // prompts and check regexes, plans/ holds the seed analysis with the
    // labeled truths and stale claims. Stripped in EVERY condition — both
    // arms lose the same material, so the comparison stays fair.
    for (const answerKeyPath of ["eval", "plans"]) {
      await rm(join(sandboxDir, answerKeyPath), { recursive: true, force: true });
    }

    await applyCondition(sandboxDir, opts.condition, opts);
    if (opts.prepare) await opts.prepare(sandboxDir);

    await execa("git", ["init", "-q"], { cwd: sandboxDir });
    await execa("git", ["add", "-A"], { cwd: sandboxDir });
    await execa(
      "git",
      ["-c", "user.name=eval", "-c", "user.email=eval@test", "commit", "-q", "-m", "initial"],
      { cwd: sandboxDir },
    );

    const runId = `eval-${randomBytes(4).toString("hex")}`;
    const runDir = join(sandboxDir, ".saaga-runs", runId);
    await mkdir(runDir, { recursive: true });

    return {
      sandboxDir: resolve(sandboxDir),
      runDir: resolve(runDir),
      runId,
      cleanup: () => rm(base, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}
