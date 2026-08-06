import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { buildProfile, ALLOWED_SHELL_COMMANDS } from "../../src/agent/permissions.js";

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

  test("sets shell to restricted", () => {
    const profile = buildProfile({ appPath, docsDir, runDir });
    expect(profile.shell).toBe("restricted");
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

describe("ALLOWED_SHELL_COMMANDS", () => {
  test("utilities contains navigation and inspection commands", () => {
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("cd");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("ls");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("pwd");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("grep");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("head");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("tail");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("wc");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("dirname");
    expect(ALLOWED_SHELL_COMMANDS.utilities).toContain("basename");
  });

  test("git contains expected subcommands", () => {
    expect(ALLOWED_SHELL_COMMANDS.git).toContain("log");
    expect(ALLOWED_SHELL_COMMANDS.git).toContain("show");
    expect(ALLOWED_SHELL_COMMANDS.git).toContain("diff");
    expect(ALLOWED_SHELL_COMMANDS.git).toContain("blame");
    expect(ALLOWED_SHELL_COMMANDS.git).toContain("status");
  });

  test("git does not contain mutating subcommands", () => {
    const git = ALLOWED_SHELL_COMMANDS.git as readonly string[];
    expect(git).not.toContain("commit");
    expect(git).not.toContain("push");
    expect(git).not.toContain("checkout");
    expect(git).not.toContain("reset");
    expect(git).not.toContain("rebase");
    expect(git).not.toContain("config");
  });
});
