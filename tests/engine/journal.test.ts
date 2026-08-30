import { appendFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createJournal,
  flowHash,
  foreachChildAddress,
  ifChildAddress,
  loopChildAddress,
  openJournal,
  topLevelAddress,
} from "../../src/engine/journal.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import {
  findResumableRun,
  isProcessAlive,
  readManifest,
  writeManifest,
  type RunManifest,
} from "../../src/run-manifest.js";

async function tmp(prefix = "saaga-journal-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("step addresses", () => {
  test("compose the documented shape", () => {
    const top = topLevelAddress(7);
    const slice = foreachChildAddress(top, 3, 0);
    const loop = foreachChildAddress(top, 3, 1);
    const verify = loopChildAddress(loop, 2, 0);
    const fix = ifChildAddress(loopChildAddress(loop, 2, 2), 0);
    expect(top).toBe("steps[7]");
    expect(slice).toBe("steps[7]@3/do[0]");
    expect(verify).toBe("steps[7]@3/do[1]#2/do[0]");
    expect(fix).toBe("steps[7]@3/do[1]#2/do[2]/then[0]");
  });
});

describe("journal", () => {
  test("round-trips records through steps.jsonl", async () => {
    const dir = await tmp();
    const journal = createJournal(dir);
    expect(journal.size()).toBe(0);
    await journal.append({ addr: "steps[0]", type: "agent", at: "t0" });
    await journal.append({
      addr: "steps[1]",
      type: "script",
      set: "phases",
      value: [{ number: 1, title: "x" }],
      at: "t1",
    });

    const reopened = await openJournal(dir);
    expect(reopened.size()).toBe(2);
    expect(reopened.has("steps[0]")?.type).toBe("agent");
    expect(reopened.has("steps[1]")?.value).toEqual([{ number: 1, title: "x" }]);
    expect(reopened.has("steps[2]")).toBeUndefined();
  });

  test("opens as empty when no journal exists yet", async () => {
    const dir = await tmp();
    const journal = await openJournal(dir);
    expect(journal.size()).toBe(0);
  });

  test("drops a torn last line but rejects corruption earlier in the file", async () => {
    const dir = await tmp();
    const path = join(dir, "steps.jsonl");
    await writeFile(
      path,
      JSON.stringify({ addr: "steps[0]", type: "agent", at: "t" }) + "\n" +
        '{"addr":"steps[1]","type":"scr',
      "utf8",
    );
    const journal = await openJournal(dir);
    expect(journal.size()).toBe(1);
    expect(journal.has("steps[1]")).toBeUndefined();

    await writeFile(
      path,
      "garbage\n" + JSON.stringify({ addr: "steps[0]", type: "agent", at: "t" }) + "\n",
      "utf8",
    );
    await expect(openJournal(dir)).rejects.toThrow(/corrupt record/);
  });

  test("appending after reopening continues the same file", async () => {
    const dir = await tmp();
    await createJournal(dir).append({ addr: "steps[0]", type: "agent", at: "t" });
    const reopened = await openJournal(dir);
    await reopened.append({ addr: "steps[1]", type: "agent", at: "t" });
    const lines = (await readFile(join(dir, "steps.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("refuses a set value that cannot be serialised", async () => {
    const dir = await tmp();
    const journal = createJournal(dir);
    await expect(
      journal.append({ addr: "steps[0]", type: "script", set: "x", value: () => 1, at: "t" }),
    ).rejects.toThrow(/not JSON-serialisable/);
  });
});

describe("flowHash", () => {
  const raw = {
    name: "f",
    steps: [
      { script: { name: "a", label: "first" } },
      { agent: { prompt: "p", vars: { x: "1" } } },
    ],
  };

  test("is stable across re-parses of the same definition", () => {
    expect(flowHash(parseFlowDefinition(raw))).toBe(
      flowHash(parseFlowDefinition(structuredClone(raw))),
    );
  });

  test("changes when the structure changes", () => {
    const edited = structuredClone(raw);
    edited.steps[0] = { script: { name: "a", label: "renamed" } };
    expect(flowHash(parseFlowDefinition(edited))).not.toBe(
      flowHash(parseFlowDefinition(raw)),
    );
  });
});

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    runId: "app-init-20260101-000000-00000000",
    flow: "init",
    flowHash: "h",
    app: "app",
    appPath: "/app",
    docsDir: "saaga-docs",
    initialScope: { app: "app" },
    status: "running",
    pid: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    resumedAt: [],
    ...overrides,
  };
}

describe("run manifest", () => {
  test("writes atomically and reads back", async () => {
    const dir = await tmp();
    await writeManifest(dir, manifest({ status: "interrupted" }));
    expect(await readdir(dir)).toEqual(["run.json"]);
    const read = await readManifest(dir);
    expect(read.status).toBe("interrupted");
    expect(read.initialScope).toEqual({ app: "app" });
  });

  test("rejects a manifest missing required fields", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "run.json"), JSON.stringify({ runId: "x" }), "utf8");
    await expect(readManifest(dir)).rejects.toThrow(/missing 'flow'/);
  });

  test("findResumableRun picks the newest interrupted or failed run", async () => {
    const app = await tmp("saaga-app-");
    const runs = join(app, ".saaga-runs");
    const make = async (id: string, m: Partial<RunManifest>) => {
      await mkdir(join(runs, id), { recursive: true });
      await writeManifest(join(runs, id), manifest({ runId: id, ...m }));
    };
    await make("a", { status: "completed", startedAt: "2026-01-05T00:00:00Z" });
    await make("b", { status: "interrupted", startedAt: "2026-01-02T00:00:00Z" });
    await make("c", { status: "failed", startedAt: "2026-01-03T00:00:00Z", flow: "update" });
    await make("d", { status: "running", startedAt: "2026-01-04T00:00:00Z" });
    await mkdir(join(runs, "doctor"), { recursive: true });
    await appendFile(join(runs, "doctor", "x.log"), "noise", "utf8");

    expect((await findResumableRun(app))?.manifest.runId).toBe("c");
    expect((await findResumableRun(app, "init"))?.manifest.runId).toBe("b");
    expect(await findResumableRun(app, "quick-update")).toBeUndefined();
    expect(await findResumableRun(await tmp("saaga-empty-"))).toBeUndefined();
  });

  test("isProcessAlive", () => {
    expect(isProcessAlive(process.pid)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    // Very unlikely to be a live pid.
    expect(isProcessAlive(2 ** 22 - 1)).toBe(false);
  });
});
