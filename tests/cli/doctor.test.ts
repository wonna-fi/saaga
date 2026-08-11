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

async function doctorBackends(args: string[]): Promise<string[]> {
  const out = new StringWritable();
  await runCli(args, { stdout: out, stderr: new StringWritable() });
  const result = JSON.parse(out.text) as { backends: { backend: string }[] };
  return result.backends.map((b) => b.backend);
}

describe("saaga doctor --backend", () => {
  // Regression: the program defines -b/--backend, and commander binds the
  // long form to the parent. A subcommand copy of the same flag silently
  // keeps its default, so doctor checked every backend whatever was asked.
  test("honors --backend given after the subcommand", async () => {
    expect(await doctorBackends(["doctor", "--backend", "claude", "--json"])).toEqual([
      "claude",
    ]);
  });

  test("honors --backend given before the subcommand", async () => {
    expect(await doctorBackends(["--backend", "copilot", "doctor", "--json"])).toEqual([
      "copilot",
    ]);
  });

  test("honors the -b short form", async () => {
    expect(await doctorBackends(["-b", "cursor", "doctor", "--json"])).toEqual(["cursor"]);
  });

  test("checks every backend when none is named", async () => {
    expect(await doctorBackends(["doctor", "--json"])).toEqual([
      "cursor",
      "copilot",
      "claude",
    ]);
  });
});

interface DoctorJson {
  backends: { backend: string; available: boolean; probes: { probeId: string }[] }[];
}

async function doctorJson(args: string[]): Promise<DoctorJson> {
  const out = new StringWritable();
  await runCli(args, { stdout: out, stderr: new StringWritable() });
  return JSON.parse(out.text) as DoctorJson;
}

function firstAvailableBackend(result: DoctorJson): string | undefined {
  return result.backends.find((b) => b.available)?.backend;
}

describe("saaga doctor --probe", () => {
  // Regression: commander's variadic option only splits on spaces, so the
  // comma-separated form documented in the help ran no probes at all.
  test("accepts a comma-separated list", async () => {
    const all = await doctorJson(["doctor", "--json"]);
    const backend = firstAvailableBackend(all);
    if (!backend) return; // no CLIs installed (CI)

    const result = await doctorJson([
      "doctor", "--backend", backend,
      "--probe", "version,unknown-model-fails,required-flags", "--json",
    ]);
    const ids = result.backends[0].probes.map((p) => p.probeId);
    expect(ids).toEqual(["version", "required-flags", "unknown-model-fails"]);
  });

  test("accepts a space-separated list", async () => {
    const all = await doctorJson(["doctor", "--json"]);
    const backend = firstAvailableBackend(all);
    if (!backend) return;

    const result = await doctorJson([
      "doctor", "--backend", backend,
      "--probe", "version", "unknown-model-fails", "--json",
    ]);
    const ids = result.backends[0].probes.map((p) => p.probeId);
    expect(ids).toEqual(["version", "unknown-model-fails"]);
  });

  test("runs every applicable probe when none is named", async () => {
    const all = await doctorJson(["doctor", "--json"]);
    const backend = firstAvailableBackend(all);
    if (!backend) return;

    const result = await doctorJson([
      "doctor", "--backend", backend, "--json",
    ]);
    const ids = result.backends[0].probes.map((p) => p.probeId);
    expect(ids).toContain("version");
    expect(ids).toContain("required-flags");
    expect(ids.length).toBeGreaterThan(1);
  });
});
