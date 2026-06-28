import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";

describe("FakeAgent", () => {
  test("returns canned exit code and records the call", async () => {
    const fake = new FakeAgent({
      "Document the architecture": { exitCode: 0 },
    });

    const result = await fake.run("Document the architecture of myapp", {
      cwd: "/tmp/myapp",
    });

    expect(result.exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].prompt).toBe("Document the architecture of myapp");
    expect(fake.calls[0].cwd).toBe("/tmp/myapp");
  });

  test("matches first matching scenario by substring", async () => {
    const fake = new FakeAgent({
      architecture: { exitCode: 0 },
      verify: { exitCode: 1 },
    });

    const r1 = await fake.run("Run architecture step", { cwd: "/app" });
    const r2 = await fake.run("Run verify step", { cwd: "/app" });

    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });

  test("throws when no scenario matches", async () => {
    const fake = new FakeAgent({
      architecture: { exitCode: 0 },
    });

    await expect(
      fake.run("unmatched prompt", { cwd: "/app" }),
    ).rejects.toThrow("FakeAgent: no scenario matched prompt");
  });

  test("records multiple calls in order", async () => {
    const fake = new FakeAgent({ step: { exitCode: 0 } });

    await fake.run("step one", { cwd: "/a" });
    await fake.run("step two", { cwd: "/b" });
    await fake.run("step three", { cwd: "/c" });

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0]).toEqual({ prompt: "step one", cwd: "/a" });
    expect(fake.calls[1]).toEqual({ prompt: "step two", cwd: "/b" });
    expect(fake.calls[2]).toEqual({ prompt: "step three", cwd: "/c" });
  });
});
