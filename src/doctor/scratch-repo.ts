import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

export interface ScratchRepo {
  appDir: string;
  runDir: string;
  docsDir: string;
  buildNonce: string;
  srcNonce: string;
  /** Outside both appDir and runDir; probes assert it stays unreachable. */
  outsideDir: string;
  outsideNonce: string;
  cleanup: () => Promise<void>;
}

export async function createScratchRepo(): Promise<ScratchRepo> {
  const base = join(tmpdir(), `saaga-probe-${randomBytes(4).toString("hex")}`);
  const appDir = join(base, "app");
  const runId = `probe-${randomBytes(4).toString("hex")}`;
  const runDir = join(appDir, ".saaga-runs", runId);
  const docsDir = "saaga-docs";

  const outsideDir = join(base, "outside");

  const buildNonce = randomBytes(8).toString("hex");
  const srcNonce = randomBytes(8).toString("hex");
  const outsideNonce = randomBytes(8).toString("hex");

  await mkdir(join(appDir, "src"), { recursive: true });
  await mkdir(join(appDir, "build"), { recursive: true });
  await mkdir(join(appDir, docsDir), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, "secret.txt"), `secret:${outsideNonce}\n`);

  await writeFile(join(appDir, ".gitignore"), "build/\n.saaga-runs/\n");
  await writeFile(join(appDir, "build", "generated.txt"), `nonce:${buildNonce}\n`);
  await writeFile(join(appDir, "src", "index.ts"), `export const NONCE = "${srcNonce}";\n`);
  await writeFile(join(appDir, "AGENTS.md"), "# Agent Rules\n\nDo not modify this file.\n");
  await writeFile(join(appDir, docsDir, "BASELINE"), "placeholder baseline\n");

  await execa("git", ["init"], { cwd: appDir });
  await execa("git", ["add", "-A"], { cwd: appDir });
  await execa("git", ["-c", "user.name=probe", "-c", "user.email=probe@test", "commit", "-m", "initial"], { cwd: appDir });

  return {
    appDir: resolve(appDir),
    runDir: resolve(runDir),
    docsDir,
    buildNonce,
    srcNonce,
    outsideDir: resolve(outsideDir),
    outsideNonce,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
