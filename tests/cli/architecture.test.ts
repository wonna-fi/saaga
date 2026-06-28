import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

async function tmpApp(
  name: string,
): Promise<{ root: string; app: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "saaga-test-"));
  const app = join(root, name);
  await mkdir(app);
  const home = join(root, "home");
  await mkdir(home);
  return { root, app, home };
}

describe("saaga architecture", () => {
  test("renders the document-architecture prompt and invokes the agent once", async () => {
    const { app, home } = await tmpApp("salesforce");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const exitCode = await runCli(["architecture", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    // The {app} template variable should be substituted with the app name.
    expect(fake.calls[0].prompt).toContain("salesforce");
    // The agent runs in the app directory.
    expect(fake.calls[0].cwd).toBe(app);
  });

  test("returns non-zero exit code when the agent fails", async () => {
    const { app, home } = await tmpApp("failapp");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 7 },
    });

    const exitCode = await runCli(["architecture", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).not.toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  test("rejects a non-existent directory", async () => {
    const fake = new FakeAgent({});
    await expect(
      runCli(["architecture", "/nonexistent/path/xyz"], { agent: fake }),
    ).rejects.toThrow(/not found/i);
  });

  test("requires a backend when no test agent is injected", async () => {
    const { app } = await tmpApp("noback");
    await expect(
      runCli(["architecture", app], { env: {} }),
    ).rejects.toThrow(/Backend must be specified/);
  });

});
