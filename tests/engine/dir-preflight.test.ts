import { posix, win32 } from "node:path";
import { describe, expect, test } from "vitest";
import { collectDirsToEnsure } from "../../src/engine/runner.js";

describe("collectDirsToEnsure", () => {
  describe("on win32", () => {
    const safeDirs = ["C:\\app\\saaga-docs", "C:\\app\\.saaga-runs\\run-1"];

    test("matches mixed-separator values under a backslash root", () => {
      // Flow YAML interpolation concatenates with "/", producing values like
      // `${app_path}/${docs_dir}/metadata/...` on a backslash app_path.
      const dirs = collectDirsToEnsure(
        ["C:\\app/saaga-docs/metadata/quick_updates/run-1/summary.md"],
        safeDirs,
        win32,
      );
      expect(dirs).toEqual(
        new Set(["C:\\app\\saaga-docs\\metadata\\quick_updates\\run-1"]),
      );
    });

    test("matches forward-slash-only values under a backslash root", () => {
      const dirs = collectDirsToEnsure(
        ["C:/app/saaga-docs/metadata/run-1/summary.md"],
        safeDirs,
        win32,
      );
      expect(dirs).toEqual(new Set(["C:\\app\\saaga-docs\\metadata\\run-1"]));
    });

    test("still matches native backslash values", () => {
      const dirs = collectDirsToEnsure(
        ["C:\\app\\.saaga-runs\\run-1\\plans\\init.plan.md"],
        safeDirs,
        win32,
      );
      expect(dirs).toEqual(new Set(["C:\\app\\.saaga-runs\\run-1\\plans"]));
    });

    test("skips values outside the safe roots", () => {
      const dirs = collectDirsToEnsure(
        ["C:\\app/src/index.ts", "C:\\elsewhere/file.md"],
        safeDirs,
        win32,
      );
      expect(dirs).toEqual(new Set());
    });

    test("skips relative and non-path values", () => {
      const dirs = collectDirsToEnsure(
        ["myapp", "saaga-docs/metadata/summary.md", "UPDATED"],
        safeDirs,
        win32,
      );
      expect(dirs).toEqual(new Set());
    });

    test("skips a value equal to a safe root", () => {
      const dirs = collectDirsToEnsure(["C:\\app\\saaga-docs"], safeDirs, win32);
      expect(dirs).toEqual(new Set());
    });
  });

  describe("on posix", () => {
    const safeDirs = ["/app/saaga-docs", "/app/.saaga-runs/run-1"];

    test("matches values under a root and returns their parents", () => {
      const dirs = collectDirsToEnsure(
        [
          "/app/saaga-docs/metadata/quick_updates/run-1/summary.md",
          "/app/.saaga-runs/run-1/quick-update-status.txt",
        ],
        safeDirs,
        posix,
      );
      expect(dirs).toEqual(
        new Set([
          "/app/saaga-docs/metadata/quick_updates/run-1",
          "/app/.saaga-runs/run-1",
        ]),
      );
    });

    test("does not match a traversal that escapes the root", () => {
      const dirs = collectDirsToEnsure(
        ["/app/saaga-docs/../outside/file.md"],
        safeDirs,
        posix,
      );
      expect(dirs).toEqual(new Set());
    });

    test("skips relative and non-path values", () => {
      const dirs = collectDirsToEnsure(["myapp", "docs/x.md"], safeDirs, posix);
      expect(dirs).toEqual(new Set());
    });
  });
});
