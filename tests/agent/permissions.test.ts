import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { buildProfile, READ_ONLY_GIT } from "../../src/agent/permissions.js";

describe("buildProfile", () => {
  const appPath = "/home/user/myapp";
  const docsDir = "saaga-docs";
  const runDir = "/home/user/myapp/.saaga-runs/myapp-init-123";

  test("produces correct read roots (runDir is under appPath, not listed separately)", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.readRoots).toEqual([appPath]);
  });

  test("produces correct write roots", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.writeRoots).toEqual([
      resolve(appPath, docsDir),
      runDir,
    ]);
  });

  test("denies rule files and BASELINE", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.denyPaths).toContain(resolve(appPath, "AGENTS.md"));
    expect(profile.denyPaths).toContain(resolve(appPath, "CLAUDE.md"));
    expect(profile.denyPaths).toContain(resolve(appPath, ".cursor/rules/**"));
    expect(profile.denyPaths).toContain(
      resolve(appPath, ".github/instructions/**"),
    );
    expect(profile.denyPaths).toContain(
      resolve(appPath, docsDir, "BASELINE"),
    );
  });

  test("sets shell to read-only-git", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.shell).toBe("read-only-git");
  });

  test("allowDirs appends to both readRoots and writeRoots", () => {
    const extraDir = "/home/user/extra";
    const profile = buildProfile({
      appPath,
      docsDir,
      runDir,
      allowDirs: [extraDir],
    });
    expect(profile.readRoots).toContain(extraDir);
    expect(profile.writeRoots).toContain(extraDir);
  });

  test("multiple allowDirs all appended", () => {
    const profile = buildProfile({
      appPath,
      docsDir,
      runDir,
      allowDirs: ["/dir/a", "/dir/b"],
    });
    expect(profile.readRoots).toContain("/dir/a");
    expect(profile.readRoots).toContain("/dir/b");
    expect(profile.writeRoots).toContain("/dir/a");
    expect(profile.writeRoots).toContain("/dir/b");
  });

  test("no allowDirs keeps only base roots", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.readRoots).toHaveLength(1);
    expect(profile.writeRoots).toHaveLength(2);
  });
});

describe("READ_ONLY_GIT", () => {
  test("contains expected subcommands", () => {
    expect(READ_ONLY_GIT).toContain("log");
    expect(READ_ONLY_GIT).toContain("show");
    expect(READ_ONLY_GIT).toContain("diff");
    expect(READ_ONLY_GIT).toContain("blame");
    expect(READ_ONLY_GIT).toContain("status");
  });

  test("does not contain mutating subcommands", () => {
    expect(READ_ONLY_GIT).not.toContain("commit");
    expect(READ_ONLY_GIT).not.toContain("push");
    expect(READ_ONLY_GIT).not.toContain("checkout");
    expect(READ_ONLY_GIT).not.toContain("reset");
    expect(READ_ONLY_GIT).not.toContain("rebase");
    expect(READ_ONLY_GIT).not.toContain("config");
  });
});
