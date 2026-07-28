import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { OutputSink, formatDuration, truncateLabel } from "../src/output.js";

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

describe("OutputSink", () => {
  test("phaseBegin + phaseEnd emits aligned [DONE] in CI mode", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.phaseBegin("Phase 1/3: documenting architecture");
    sink.phaseEnd("DONE", 3120);

    const output = stream.text;
    expect(output).toContain("[DONE]");
    expect(output).toContain("3.1s");
    expect(output).not.toMatch(/\x1b\[/);
  });

  test("phaseImmediate emits a complete line with marker", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.phaseImmediate("Phase 2/5: updating docs (no changes)", "SKIP");

    const output = stream.text;
    expect(output).toContain("[SKIP]");
    expect(output).toContain("Phase 2/5: updating docs (no changes)");
    expect(output).toMatch(/\n$/);
  });

  test("phaseImmediate with FAIL marker", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.phaseImmediate("saaga init: failed at phase 3/7", "FAIL", 42000);

    const output = stream.text;
    expect(output).toContain("[FAIL]");
    expect(output).toContain("42.0s");
  });

  test("detail messages go to run.log but not terminal in quiet mode", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.detail("script parse-plan");

    expect(stream.text).toBe("");
  });

  test("detail messages go to terminal in verbose mode", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream, verbose: true });

    sink.detail("script parse-plan");

    expect(stream.text).toContain("script parse-plan");
  });

  test("warn interrupts pending line with newline", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.phaseBegin("Phase 1/3: something");
    sink.warn("watch out");

    const output = stream.text;
    expect(output).toContain("\n[WARN] watch out\n");
  });

  test("markers are column-aligned (padding)", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.phaseImmediate("Phase 1/3: short", "DONE", 10);
    sink.phaseImmediate("Phase 2/3: a much longer description here", "DONE", 20);

    const lines = stream.text.split("\n").filter(l => l.length > 0);
    const col1 = lines[0].indexOf("[DONE]");
    const col2 = lines[1].indexOf("[DONE]");
    expect(col1).toBe(col2);
  });

  test("info/warn/error produce proper tags in CI mode", () => {
    const stream = new StringWritable();
    const sink = new OutputSink({ ci: true, stream });

    sink.info("hello");
    sink.warn("careful");
    sink.error("boom");

    expect(stream.text).toContain("[INFO] hello\n");
    expect(stream.text).toContain("[WARN] careful\n");
    expect(stream.text).toContain("[ERROR] boom\n");
  });
});

describe("formatDuration", () => {
  test("milliseconds", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  test("seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  test("minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m00s");
    expect(formatDuration(90000)).toBe("1m30s");
    expect(formatDuration(3661000)).toBe("61m01s");
  });
});

describe("truncateLabel", () => {
  test("no truncation needed", () => {
    const result = truncateLabel("Phase 1/3: ", "short", "", 72);
    expect(result).toBe("Phase 1/3: short");
  });

  test("truncates long labels", () => {
    const label = "a".repeat(80);
    const result = truncateLabel("Phase 1/3: ", label, " (iteration 1/3)", 72);
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result).toContain("\u2026");
    expect(result).toContain("Phase 1/3: ");
    expect(result).toContain(" (iteration 1/3)");
  });

  test("preserves suffix even with very long label", () => {
    const label = "x".repeat(200);
    const result = truncateLabel("Phase 10/16: ", label, " (iteration 3/3)", 72);
    expect(result).toContain("(iteration 3/3)");
    expect(result).toContain("Phase 10/16: ");
  });
});
