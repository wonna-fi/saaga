import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";

async function tmpQuickUpdateEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-quick-"));
  const app = join(root, name);
  const home = join(root, "home");
  await mkdir(app);
  await mkdir(home);
  await writeFile(join(app, "src.ts"), "alpha", "utf8");
  await generateBaseline({ app_dir: app }, { cwd: app });
  return { root, app, home };
}

function quickUpdateScenario(
  status: "UPDATED" | "SKIPPED",
): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const statusMatch = prompt.match(/Status file at `([^`]+)`/);
      if (!statusMatch) throw new Error("status path not found in prompt");
      const statusPath = statusMatch[1];
      await mkdir(dirname(statusPath), { recursive: true });
      await writeFile(statusPath, status, "utf8");

      if (status === "UPDATED") {
        const summaryMatch = prompt.match(
          /If UPDATED: summary file at `([^`]+)`/,
        );
        if (!summaryMatch)
          throw new Error("summary path not found in prompt");
        const summaryPath = summaryMatch[1];
        await mkdir(dirname(summaryPath), { recursive: true });
        await writeFile(
          summaryPath,
          `---\ngenerated: 2026-06-03T10:00:00Z\nverified: false\ndocs_touched:\n  - docs/concepts/test.md\nconfidence: medium\n---\n\nUpdated test concept.\n`,
          "utf8",
        );
      }
    },
  };
}

describe("saaga quick-update", () => {
  test("zero changes: no agent is invoked", async () => {
    const { app, home } = await tmpQuickUpdateEnv("noop");

    const fake = new FakeAgent({
      "Quick-Update Domain Documentation": quickUpdateScenario("UPDATED"),
    });

    const exitCode = await runCli(["quick-update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test("UPDATED: agent runs, metadata artifact is created, baseline is regenerated", async () => {
    const { app, home } = await tmpQuickUpdateEnv("updated");
    await writeFile(join(app, "src.ts"), "modified", "utf8");

    const fake = new FakeAgent({
      "Quick-Update Domain Documentation": quickUpdateScenario("UPDATED"),
    });

    const exitCode = await runCli(["quick-update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].prompt).toContain("Quick-Update Domain Documentation");

    const metaDir = join(app, "docs", "metadata", "quick_updates");
    const metaEntries = await readdir(metaDir);
    expect(metaEntries).toHaveLength(1);

    const artifactDir = join(metaDir, metaEntries[0]);
    const changesContent = await readFile(
      join(artifactDir, "changes.md"),
      "utf8",
    );
    expect(changesContent).toContain("# Changes Since BASELINE");

    const summaryContent = await readFile(
      join(artifactDir, "summary.md"),
      "utf8",
    );
    expect(summaryContent).toContain("verified: false");

    const baselineStat = await stat(join(app, "docs", "BASELINE"));
    expect(baselineStat.isFile()).toBe(true);
  });

  test("SKIPPED: no metadata artifact, but baseline is still regenerated", async () => {
    const { app, home } = await tmpQuickUpdateEnv("skipped");
    await writeFile(join(app, "src.ts"), "modified", "utf8");

    const fake = new FakeAgent({
      "Quick-Update Domain Documentation": quickUpdateScenario("SKIPPED"),
    });

    const exitCode = await runCli(["quick-update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);

    const metaDir = join(app, "docs", "metadata", "quick_updates");
    await expect(readdir(metaDir)).rejects.toThrow();

    const baselineStat = await stat(join(app, "docs", "BASELINE"));
    expect(baselineStat.isFile()).toBe(true);
  });
});
