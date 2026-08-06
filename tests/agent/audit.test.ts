import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { classifyDenial, PermissionAuditor } from "../../src/agent/audit.js";
import type { DenialEvent } from "../../src/agent/events.js";
import type { AgentPermissions } from "../../src/agent/permissions.js";

const APP = "/app";
const RUN = "/run/saaga-1";

const perms: AgentPermissions = {
  readRoots: [APP, RUN],
  writeRoots: [`${APP}/saaga-docs`, RUN],
  denyPaths: [`${APP}/AGENTS.md`, `${APP}/saaga-docs/BASELINE`, `${APP}/.cursor/rules/**`],
  shell: "restricted",
};

function denial(partial: Partial<DenialEvent>): DenialEvent {
  return { kind: "denial", tool: "Write", message: "denied", ...partial };
}

describe("classifyDenial", () => {
  test("a refusal inside a write root is our bug, not the agent's", () => {
    const result = classifyDenial(
      denial({ path: `${APP}/saaga-docs/overview.md` }),
      perms,
      APP,
    );
    expect(result.className).toBe("unexpected");
  });

  test("the run directory counts as granted too", () => {
    expect(classifyDenial(denial({ path: `${RUN}/plan.md` }), perms, APP).className).toBe(
      "unexpected",
    );
  });

  test("a path outside every root is actionable via --allow-dir", () => {
    expect(classifyDenial(denial({ path: "/etc/hostname" }), perms, APP).className).toBe(
      "out-of-workspace",
    );
  });

  test("readable but unwritable source is expected", () => {
    expect(classifyDenial(denial({ path: `${APP}/src/index.ts` }), perms, APP).className).toBe(
      "protected-path",
    );
  });

  test("an explicit deny wins over the write root containing it", () => {
    // BASELINE sits inside saaga-docs, which is a write root; the deny is the
    // more specific statement and must not be reported as a profile bug.
    expect(
      classifyDenial(denial({ path: `${APP}/saaga-docs/BASELINE` }), perms, APP).className,
    ).toBe("protected-path");
  });

  test("glob deny entries match the directory they cover", () => {
    expect(
      classifyDenial(denial({ path: `${APP}/.cursor/rules/main.mdc` }), perms, APP).className,
    ).toBe("protected-path");
  });

  test("relative paths are resolved against the working directory", () => {
    const result = classifyDenial(denial({ path: "src/index.ts" }), perms, APP);
    expect(result.resolvedPath).toBe(`${APP}/src/index.ts`);
    expect(result.className).toBe("protected-path");
  });

  test("shell refusals are classified by tool, before any path check", () => {
    expect(classifyDenial(denial({ tool: "bash", path: undefined }), perms, APP).className).toBe(
      "shell",
    );
  });

  test("a denial with no path cannot be placed", () => {
    expect(classifyDenial(denial({ tool: "Edit" }), perms, APP).className).toBe("unknown");
  });
});

describe("PermissionAuditor", () => {
  test("counts by class and exposes the ones worth acting on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    const logPath = join(dir, "permission-audit.log");
    const auditor = new PermissionAuditor(perms, APP, logPath);

    auditor.record(denial({ path: `${APP}/src/index.ts` }));
    auditor.record(denial({ path: "/etc/hostname" }));
    auditor.record(denial({ path: `${APP}/saaga-docs/overview.md` }));
    auditor.record(denial({ tool: "bash" }));
    auditor.record({ kind: "session", tools: ["Read"] });

    const result = await auditor.flush();
    expect(result.counts).toEqual({
      unexpected: 1,
      "out-of-workspace": 1,
      "protected-path": 1,
      shell: 1,
      unknown: 0,
    });
    expect(result.unexpected).toHaveLength(1);
    expect(result.unexpected[0].resolvedPath).toBe(`${APP}/saaga-docs/overview.md`);

    const log = await readFile(logPath, "utf8");
    expect(log).toContain("## unexpected (1)");
    expect(log).toContain(`${APP}/saaga-docs/overview.md`);
    expect(log).toContain("Total denials: 4");
  });

  test("folds repeats of the same target and trims the CLI's boilerplate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    const logPath = join(dir, "permission-audit.log");
    const auditor = new PermissionAuditor(perms, APP, logPath);

    const verbose =
      "Permission to use Write has been denied because Claude Code is running in don't ask mode. " +
      "IMPORTANT: You *may* attempt to accomplish this action using other tools that might " +
      "naturally be used to accomplish this goal, e.g. using head instead of cat.";
    for (let i = 0; i < 3; i++) {
      auditor.record(denial({ path: `${APP}/src/index.ts`, message: verbose }));
    }

    const result = await auditor.flush();
    expect(result.counts["protected-path"]).toBe(3);

    const log = await readFile(logPath, "utf8");
    expect(log).toContain("(x3)");
    expect(log).toContain(
      "Permission to use Write has been denied because Claude Code is running in don't ask mode.",
    );
    expect(log).not.toContain("IMPORTANT:");
  });

  test("writes a summary even when nothing was denied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    const logPath = join(dir, "permission-audit.log");
    const result = await new PermissionAuditor(perms, APP, logPath).flush();

    expect(result.unexpected).toEqual([]);
    expect(await readFile(logPath, "utf8")).toContain("Total denials: 0");
  });
});
