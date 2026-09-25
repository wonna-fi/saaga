import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { CODEX_SHELL_COMMANDS } from "../../src/agent/codex-agent.js";
import { CODEX_HOOK_SCRIPT } from "../../src/agent/codex-hook.js";

function hook(tool: string, command?: string, shell = "restricted") {
  const result = spawnSync(process.execPath, ["-e", CODEX_HOOK_SCRIPT,
    JSON.stringify({ ...CODEX_SHELL_COMMANDS, shell })], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool,
      tool_input: { command } }), encoding: "utf8", timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  const output = result.stdout ? JSON.parse(result.stdout) : undefined;
  return { ...result, output,
    denied: result.status === 2 || output?.hookSpecificOutput?.permissionDecision === "deny" };
}

describe("Codex PreToolUse hook", () => {
  test.each([
    "pwd", "ls -la", "cat src/index.ts", "rg --files --hidden", "rg 'class Foo' src",
    "cd '/project with spaces' && git log --oneline -1",
    "git show HEAD:src/index.ts", "git diff -- src", "git status --short",
    "git ls-files | head -20", "cat 'a;$(touch pwned).txt'",
  ])("allows read-only command %s", (command) => {
    const result = hook("Bash", command);
    expect(result.status).toBe(0);
    expect(result.denied).toBe(false);
  });

  test.each([
    "sha256sum src/index.ts", "python3 -c 'print(1)'", "sh -c pwd", "/bin/ls",
    "git commit -m nope", "git -c core.pager=sh log", "git diff --ext-diff",
    "git show --textconv", "git cat-file --filters HEAD:file", "git diff --output=out",
    "git diff --ext", "git show --textc", "git diff --out=out", "git cat-file --fil HEAD:file",
    "rg --pre=python pattern", "rg --pre python pattern", "pwd > src/pwned",
    "rg --hostname-bin /tmp/callback --hyperlink-format 'file://{host}{path}' --color always needle input.txt",
    "rg --hostname-bin=/tmp/callback --hyperlink-format 'file://{host}{path}' --color always needle input.txt",
    "cat $(touch pwned)", 'cat "$(touch pwned)"', "cat `touch pwned`",
    "ls; touch pwned", "ls\ntouch pwned", "ls &", "ls *", "ls file?", "pwd &&", "|| pwd",
    "PATH=/evil ls", "env ls", "ls $(pwd)", "ls <(pwd)", "cat <<EOF", "cat 'unterminated",
    "pwd && sha256sum src/index.ts", "pwd | sh", "cat a\\;touch pwned", "",
  ])("blocks command %s", (command) => {
    expect(hook("Bash", command).denied).toBe(true);
  });

  test("neutralizes git callbacks when rewriting commands", () => {
    const result = hook("Bash", "git diff -- src && git blame src/index.ts");
    const command = result.output.hookSpecificOutput.updatedInput.command;
    expect(command).toContain("'core.fsmonitor=false'");
    expect(command).toContain("'diff.external='");
    expect(command).toContain("'--no-ext-diff'");
    expect(command).toContain("'--no-textconv'");
    expect(command).toContain(" && ");
  });

  test("preserves quoted literal arguments when rewriting", () => {
    const result = hook("Bash", 'cat "a b.txt" | head -1');
    expect(result.output.hookSpecificOutput.updatedInput.command).toBe("'cat' 'a b.txt' | 'head' '-1'");
  });

  describe.each([
    ["gpg.program", "PGP SIGNATURE"],
    ["gpg.openpgp.program", "PGP SIGNATURE"],
    ["gpg.x509.program", "SIGNED MESSAGE"],
    ["gpg.ssh.program", "SSH SIGNATURE"],
  ])("Git signature callback %s", (setting, signature) => {
    test.each([
      "git log --show-signature --format=%s -1",
      "git log --format='%s %G?' -1",
      "git log --oneline -1",
      "git show --show-signature --format=%s --no-patch HEAD",
    ])("keeps history readable without running the callback: %s", (command) => {
      const cwd = mkdtempSync(join(tmpdir(), "saaga-codex-signature-"));
      const env = {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(cwd, "absent-global-config"),
        GIT_CONFIG_COUNT: "0",
      };
      const marker = join(cwd, "callback-ran");
      const git = (args: string[], input?: string) => {
        const result = spawnSync("git", args, { cwd, env, input, encoding: "utf8", timeout: 5000 });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim();
      };
      try {
        const callback = join(cwd, "callback");
        // Drain stdin before exiting so Git can finish writing the signed payload.
        writeFileSync(callback, "#!/bin/sh\nprintf called > callback-ran\ncat > /dev/null\nexit 1\n", { mode: 0o755 });
        writeFileSync(join(cwd, "allowed-signers"), "");
        git(["init", "-q"]);
        const tree = git(["hash-object", "-w", "-t", "tree", "--stdin"], "");
        // Git selects the verifier from the signature header before validating it.
        // Exceed the pipe buffer so the verifier must consume Git's input.
        const payload = "Signed payload\n".repeat(8192);
        const commit = `tree ${tree}\nauthor Test <test@example.invalid> 1750000000 +0000\ncommitter Test <test@example.invalid> 1750000000 +0000\ngpgsig -----BEGIN ${signature}-----\n \n fake\n -----END ${signature}-----\n\nSigned fixture\n\n${payload}`;
        git(["update-ref", "HEAD", git(["hash-object", "-w", "-t", "commit", "--stdin"], commit)]);
        git(["config", setting, callback]);
        git(["config", "gpg.ssh.allowedSignersFile", join(cwd, "allowed-signers")]);
        git(["config", "log.showSignature", "true"]);

        // Prove the fixture triggers the callback without the guard.
        const unguarded = spawnSync("sh", ["-c", command], { cwd, env, encoding: "utf8", timeout: 5000 });
        expect(unguarded.error).toBeUndefined();
        expect(unguarded.status, unguarded.stderr).toBe(0);
        expect(existsSync(marker)).toBe(true);
        rmSync(marker);

        const result = hook("Bash", command);
        expect(result.denied).toBe(false);
        const guarded = spawnSync("sh", ["-c", result.output.hookSpecificOutput.updatedInput.command], {
          cwd, env, encoding: "utf8", timeout: 5000,
        });
        expect(guarded.error).toBeUndefined();
        expect(existsSync(marker)).toBe(false);
        expect(guarded.status, guarded.stderr).toBe(0);
        expect(guarded.stdout).toContain("Signed fixture");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  test.each(["apply_patch", "update_plan"])("allows %s", (tool) => {
    expect(hook(tool).denied).toBe(false);
  });

  test.each(["spawn_agent", "mcp__files__write", "view_image", "exec_command", "unknown"])("blocks %s", (tool) => {
    expect(hook(tool).denied).toBe(true);
  });

  test("shell none still permits file edits", () => {
    expect(hook("Bash", "pwd", "none").denied).toBe(true);
    expect(hook("apply_patch", "patch", "none").denied).toBe(false);
  });

  test("malformed hook input blocks rather than throwing an ordinary hook failure", () => {
    const result = spawnSync(process.execPath, ["-e", CODEX_HOOK_SCRIPT, "{}"], {
      input: "not json", encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Saaga policy:");
  });
});
