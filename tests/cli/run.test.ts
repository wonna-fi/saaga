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

describe("saaga run", () => {
  test("no flow argument lists available flows and exits 0", async () => {
    const out = new StringWritable();
    const exitCode = await runCli(["run"], { stdout: out });
    expect(exitCode).toBe(0);
    const text = out.text;
    expect(text).toContain("Available flows:");
    for (const name of ["init", "update", "quick-update", "verify-quick-updates"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("Usage: saaga run <flow> [dir]");
  });

  test("listing includes flow descriptions", async () => {
    const out = new StringWritable();
    await runCli(["run"], { stdout: out });
    expect(out.text).toContain("Generate full initial documentation");
  });

  test("unknown flow name exits non-zero with helpful message", async () => {
    const err = new StringWritable();
    await expect(
      runCli(["run", "nonexistent"], { stderr: err }),
    ).rejects.toThrow("Unknown flow 'nonexistent'");
  });
});

describe("deprecated command stubs", () => {
  for (const oldCmd of ["init", "update", "quick-update", "verify-quick-updates"]) {
    test(`'saaga ${oldCmd}' prints migration pointer and exits 1`, async () => {
      const err = new StringWritable();
      const exitCode = await runCli([oldCmd, "."], { stderr: err });
      expect(exitCode).toBe(1);
      expect(err.text).toContain(`saaga run ${oldCmd}`);
    });
  }
});
