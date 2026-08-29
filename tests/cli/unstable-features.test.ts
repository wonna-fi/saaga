import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { writeFormatVersion } from "../../src/docs/format-version.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";

class StringWritable extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: string,
    cb: (e?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    cb();
  }
  get text(): string {
    return this.chunks.join("");
  }
}

async function tmpApp(name: string, configYaml?: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-unstable-"));
  const app = join(root, name);
  await mkdir(app);
  await writeFile(join(app, "src.ts"), "alpha", "utf8");
  if (configYaml !== undefined) {
    await mkdir(join(app, ".saaga"));
    await writeFile(join(app, ".saaga", "config.yaml"), configYaml, "utf8");
  }
  await generateBaseline(
    { app_dir: app, docs_dir: DEFAULT_DOCS_DIR },
    { cwd: app },
  );
  await writeFormatVersion(join(app, DEFAULT_DOCS_DIR));
  return { root, app };
}

describe("unstable features (CLI integration)", () => {
  test("config-enabled feature prints warning and runs", async () => {
    const { app } = await tmpApp("cfgnone", "unstableFeatures: [none]\n");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
    });

    expect(exitCode).toBe(0);
    expect(err.text).toContain("[WARN] Unstable features enabled: none");
  });

  test("CLI --unstable-feature flag prints warning and runs", async () => {
    const { app } = await tmpApp("cliflag");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(
      ["run", "quick-update", app, "--unstable-feature", "none"],
      { agent: fake, stderr: err },
    );

    expect(exitCode).toBe(0);
    expect(err.text).toContain("[WARN] Unstable features enabled: none");
  });

  test("config + CLI union deduplicates", async () => {
    const { app } = await tmpApp("union", "unstableFeatures: [none]\n");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(
      ["run", "quick-update", app, "--unstable-feature", "none"],
      { agent: fake, stderr: err },
    );

    expect(exitCode).toBe(0);
    const matches = err.text.match(/\[WARN\] Unstable features enabled:/g);
    expect(matches).toHaveLength(1);
    expect(err.text).toContain("Unstable features enabled: none");
  });

  test("warning appears before cost notice", async () => {
    const { app } = await tmpApp("order", "unstableFeatures: [none]\n");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
    });

    expect(exitCode).toBe(0);
    const warnIdx = err.text.indexOf("[WARN] Unstable features enabled:");
    const costIdx = err.text.indexOf("Cost notice:");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(costIdx).toBeGreaterThan(warnIdx);
  });

  test("unknown feature in config rejects before any work", async () => {
    const { app } = await tmpApp("badcfg", "unstableFeatures: [bogus]\n");
    const fake = new FakeAgent({});

    await expect(
      runCli(["run", "quick-update", app], { agent: fake }),
    ).rejects.toThrow(/unknown feature 'bogus'/);
    expect(fake.calls).toHaveLength(0);
  });

  test("unknown feature via CLI flag rejects before any work", async () => {
    const { app } = await tmpApp("badflag");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(
      ["run", "quick-update", app, "--unstable-feature", "nope"],
      { agent: fake, stderr: err },
    );

    expect(exitCode).toBe(1);
    expect(err.text).toContain("Unknown unstable feature 'nope'");
    expect(fake.calls).toHaveLength(0);
  });

  test("no warning when no features are enabled", async () => {
    const { app } = await tmpApp("nowarn");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
    });

    expect(exitCode).toBe(0);
    expect(err.text).not.toContain("Unstable features enabled:");
  });

  test("--help does not print unstable feature warning", async () => {
    const out = new StringWritable();
    const err = new StringWritable();

    const exitCode = await runCli(["--help"], { stdout: out, stderr: err });

    expect(exitCode).toBe(0);
    expect(err.text).not.toContain("Unstable features enabled:");
  });

  test("--version does not print unstable feature warning", async () => {
    const out = new StringWritable();
    const err = new StringWritable();

    const exitCode = await runCli(["--version"], { stdout: out, stderr: err });

    expect(exitCode).toBe(0);
    expect(err.text).not.toContain("Unstable features enabled:");
  });

  test("install-rules with unstable feature prints warning", async () => {
    const { app } = await tmpApp("rules", "unstableFeatures: [none]\n");
    const err = new StringWritable();

    const exitCode = await runCli(["install-rules", app], { stderr: err });

    expect(exitCode).toBe(0);
    expect(err.text).toContain("[WARN] Unstable features enabled: none");
  });

  test("doctor with config unstable feature prints warning", async () => {
    const err = new StringWritable();
    const out = new StringWritable();

    // Doctor reads config from cwd, so we create a temp dir with config
    const root = await mkdtemp(join(tmpdir(), "saaga-unstable-doctor-"));
    await mkdir(join(root, ".saaga"));
    await writeFile(
      join(root, ".saaga", "config.yaml"),
      "unstableFeatures: [none]\n",
      "utf8",
    );

    await runCli(["doctor"], {
      cwd: root,
      stderr: err,
      stdout: out,
    });

    // Doctor may fail (no backends) but we check the warning appeared
    expect(err.text).toContain("[WARN] Unstable features enabled: none");
  });

  test("repeated --unstable-feature flags accumulate", async () => {
    const { app } = await tmpApp("repeat");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    // Only "none" is currently available, so repeating the same name
    // should produce exactly one mention in the warning.
    const exitCode = await runCli(
      ["run", "quick-update", app, "--unstable-feature", "none", "--unstable-feature", "none"],
      { agent: fake, stderr: err },
    );

    expect(exitCode).toBe(0);
    const warnLine = err.text
      .split("\n")
      .find((l) => l.includes("Unstable features enabled:"));
    expect(warnLine).toBeDefined();
    // Only one "none" after dedup
    expect(warnLine).toBe("[WARN] Unstable features enabled: none");
  });
});
