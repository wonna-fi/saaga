import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { Logger } from "../src/logger.js";

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

describe("Logger", () => {
  test("CI mode emits plain [INFO]/[WARN]/[ERROR] tags (no ANSI escapes)", () => {
    const stream = new StringWritable();
    const log = new Logger({ ci: true, stream });
    log.info("hello");
    log.warn("watch out");
    log.error("boom");
    expect(stream.text).toBe(
      "[INFO] hello\n[WARN] watch out\n[ERROR] boom\n",
    );
    expect(stream.text).not.toMatch(/\u001b\[/);
  });

  test("non-CI mode tags still bracket the level (color may be present)", () => {
    const stream = new StringWritable();
    const log = new Logger({ ci: false, stream });
    log.info("hi");
    log.warn("w");
    log.error("e");
    const lines = stream.text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/\[INFO\] hi$/);
    expect(lines[1]).toMatch(/\[WARN\] w$/);
    expect(lines[2]).toMatch(/\[ERROR\] e$/);
  });
});
