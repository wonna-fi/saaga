import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { runCli } from "../../src/cli.js";

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

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

describe("saaga --version", () => {
  test("prints the package.json version and exits 0", async () => {
    const out = new StringWritable();
    const exitCode = await runCli(["--version"], { stdout: out });
    expect(exitCode).toBe(0);
    expect(normalize(out.text)).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help exits 0 and lists every subcommand once", async () => {
    const out = new StringWritable();
    const exitCode = await runCli(["--help"], { stdout: out });
    expect(exitCode).toBe(0);
    const text = out.text;
    for (const cmd of ["init", "update", "quick-update", "verify-quick-updates", "install-rules"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--backend");
    expect(text).toContain("--ci");
  });

  test("init --help lists the rule target flag with its default", async () => {
    const out = new StringWritable();
    const exitCode = await runCli(["init", "--help"], { stdout: out });
    expect(exitCode).toBe(0);
    expect(out.text).toContain("--rule-targets");
    expect(out.text).not.toContain("--skill-target");
    expect(out.text).toContain("agentsmd");
  });

  test("subcommand --help shows its own arguments", async () => {
    const out = new StringWritable();
    const exitCode = await runCli(["install-rules", "--help"], { stdout: out });
    expect(exitCode).toBe(0);
    expect(out.text).toContain("dir");
    expect(out.text).toContain("--rule-targets");
  });
});
