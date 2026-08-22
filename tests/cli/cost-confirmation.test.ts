import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import {
  ConfirmationDeclinedError,
  buildCostNotice,
  buildCostSummary,
  confirmAgentCosts,
} from "../../src/cli/confirm.js";
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

/** Readable that reports itself as a terminal, so the prompt is shown. */
function ttyStdin(text: string): NodeJS.ReadableStream {
  const stream = new Readable({
    read() {
      if (text.length > 0) this.push(text);
      this.push(null);
    },
  });
  (stream as unknown as { isTTY: boolean }).isTTY = true;
  return stream;
}

function pipedStdin(text: string): NodeJS.ReadableStream {
  return Readable.from([Buffer.from(text, "utf8")]);
}

const NOTICE_INPUT = {
  subcommand: "init",
  appPath: "/projects/acme",
  backendCli: "cursor-agent",
  backend: "cursor",
  model: "claude-4.6-opus-high-thinking",
};

/** App dir with a BASELINE and no changes: a run needs zero agent calls. */
async function tmpUnchangedApp(name: string, configYaml?: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-confirm-"));
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
  return { root, app };
}

async function runDirCount(app: string): Promise<number> {
  try {
    return (await readdir(join(app, ".saaga-runs"))).length;
  } catch {
    return 0;
  }
}

describe("buildCostNotice", () => {
  test("names the backend CLI, the resolution, the command, and the target", () => {
    const notice = buildCostNotice(NOTICE_INPUT);
    expect(notice).toContain("'saaga run init'");
    expect(notice).toContain("'cursor-agent' CLI");
    expect(notice).toContain("backend cursor");
    expect(notice).toContain("model claude-4.6-opus-high-thinking");
    expect(notice).toContain("/projects/acme");
  });

  test("states that usage is billed to the user's own backend account", () => {
    const notice = buildCostNotice(NOTICE_INPUT);
    expect(notice).toContain("consume tokens");
    expect(notice).toContain("billed to your own cursor-agent account");
    expect(notice).toContain("your plan with that provider");
  });

  test("includes a per-subcommand cost expectation", () => {
    expect(buildCostNotice(NOTICE_INPUT)).toContain("heaviest command");
    expect(
      buildCostNotice({ ...NOTICE_INPUT, subcommand: "quick-update" }),
    ).toContain("cheaper model");
    expect(buildCostNotice({ ...NOTICE_INPUT, subcommand: "update" })).toContain(
      "changed since BASELINE",
    );
    expect(
      buildCostNotice({ ...NOTICE_INPUT, subcommand: "verify-quick-updates" }),
    ).toContain("pending quick updates");
  });

  test("omits backend details when the agent was injected directly", () => {
    const notice = buildCostNotice({
      subcommand: "update",
      appPath: "/projects/acme",
      backendCli: "fake",
    });
    expect(notice).toContain("'fake' CLI as an autonomous coding agent");
    expect(notice).not.toContain("backend ");
    expect(notice).not.toContain("model ");
  });

  test("unknown subcommands simply get no cost hint", () => {
    const notice = buildCostNotice({ ...NOTICE_INPUT, subcommand: "whatever" });
    expect(notice).toContain("'saaga run whatever'");
    expect(notice.split("\n")).toHaveLength(2);
  });
});

describe("buildCostSummary", () => {
  test("condenses the notice to one line for run.log", () => {
    expect(buildCostSummary(NOTICE_INPUT)).toBe(
      "cost notice acknowledged (cli=cursor-agent, model=claude-4.6-opus-high-thinking)",
    );
    expect(
      buildCostSummary({
        subcommand: "update",
        appPath: "/projects/acme",
        backendCli: "fake",
      }),
    ).toBe("cost notice acknowledged (cli=fake)");
  });
});

describe("confirmAgentCosts", () => {
  test.each([["y\n"], ["Y\n"], ["yes\n"], ["  yes  \n"]])(
    "accepts %j",
    async (answer) => {
      const out = new StringWritable();
      await expect(
        confirmAgentCosts({
          ...NOTICE_INPUT,
          autoApprove: false,
          ci: false,
          stdin: ttyStdin(answer),
          stream: out,
        }),
      ).resolves.toBeUndefined();
      expect(out.text).toContain("Cost notice:");
      expect(out.text).toContain("Continue? [y/N]");
    },
  );

  test.each([["n\n"], ["\n"], ["maybe\n"], [""]])(
    "declines %j",
    async (answer) => {
      const out = new StringWritable();
      await expect(
        confirmAgentCosts({
          ...NOTICE_INPUT,
          autoApprove: false,
          ci: false,
          stdin: ttyStdin(answer),
          stream: out,
        }),
      ).rejects.toThrow(ConfirmationDeclinedError);
    },
  );

  test("the prompt explains how to opt out", async () => {
    const out = new StringWritable();
    await confirmAgentCosts({
      ...NOTICE_INPUT,
      autoApprove: false,
      ci: false,
      stdin: ttyStdin("y\n"),
      stream: out,
    });
    expect(out.text).toContain("--yes");
    expect(out.text).toContain("'autoApprove: true'");
  });

  test("autoApprove shows the notice without reading stdin", async () => {
    const out = new StringWritable();
    // A "no" answer would abort if stdin were consulted.
    await confirmAgentCosts({
      ...NOTICE_INPUT,
      autoApprove: true,
      ci: false,
      stdin: ttyStdin("n\n"),
      stream: out,
    });
    expect(out.text).toContain("Cost notice:");
    expect(out.text).toContain("auto-approved");
    expect(out.text).not.toContain("Continue?");
  });

  test("piped stdin continues without prompting", async () => {
    const out = new StringWritable();
    await confirmAgentCosts({
      ...NOTICE_INPUT,
      autoApprove: false,
      ci: false,
      stdin: pipedStdin("n\n"),
      stream: out,
    });
    expect(out.text).toContain("Cost notice:");
    expect(out.text).toContain("Non-interactive terminal");
    expect(out.text).not.toContain("Continue?");
  });

  test("--ci continues without prompting even on a terminal", async () => {
    const out = new StringWritable();
    await confirmAgentCosts({
      ...NOTICE_INPUT,
      autoApprove: false,
      ci: true,
      stdin: ttyStdin("n\n"),
      stream: out,
    });
    expect(out.text).toContain("Non-interactive terminal");
  });
});

describe("saaga cost confirmation (end to end)", () => {
  test("declining aborts with exit code 1 before any work happens", async () => {
    const { app } = await tmpUnchangedApp("declined");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
      stdin: ttyStdin("n\n"),
    });

    expect(exitCode).toBe(1);
    expect(err.text).toContain("Cost notice:");
    expect(err.text).toContain("aborted: cost confirmation declined");
    expect(fake.calls).toHaveLength(0);
    expect(await runDirCount(app)).toBe(0);
  });

  // No injected agent here: CliOptions.agent short-circuits resolveAgent(),
  // so these are the only tests that exercise real backend/model resolution.
  // ttyStdin + "n" is deliberate — piped stdin (and --ci) count as
  // non-interactive, which would continue past the notice into preflight and
  // could start a real, billed agent run on a machine with the CLI installed.
  test("the cost notice names the model resolved from .saaga/config.yaml", async () => {
    const { app } = await tmpUnchangedApp(
      "modelconfig",
      "defaultBackend: claude\nbackends:\n  claude:\n    models:\n      medium: config-medium\n",
    );
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      stderr: err,
      stdin: ttyStdin("n\n"),
    });

    expect(exitCode).toBe(1);
    expect(err.text).toContain("backend claude");
    expect(err.text).toContain("model config-medium");
  });

  test("--model overrides the configured model", async () => {
    const { app } = await tmpUnchangedApp(
      "modeloverride",
      "defaultBackend: claude\nbackends:\n  claude:\n    models:\n      medium: config-medium\n",
    );
    const err = new StringWritable();

    const exitCode = await runCli(
      ["run", "quick-update", app, "--model", "medium=cli-medium"],
      { stderr: err, stdin: ttyStdin("n\n") },
    );

    expect(exitCode).toBe(1);
    expect(err.text).toContain("model cli-medium");
  });

  test("accepting proceeds with the run", async () => {
    const { app } = await tmpUnchangedApp("accepted");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
      stdin: ttyStdin("y\n"),
    });

    expect(exitCode).toBe(0);
    expect(err.text).toContain("Continue? [y/N]");
    expect(await runDirCount(app)).toBe(1);
  });

  test("--yes runs without consulting stdin", async () => {
    const { app } = await tmpUnchangedApp("flagged");
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app, "--yes"], {
      agent: fake,
      stderr: err,
      stdin: ttyStdin("n\n"),
    });

    expect(exitCode).toBe(0);
    expect(err.text).toContain("auto-approved");
    expect(err.text).not.toContain("Continue?");
  });

  test("autoApprove in .saaga/config.yaml runs without consulting stdin", async () => {
    const { app } = await tmpUnchangedApp(
      "configured",
      "autoApprove: true\n",
    );
    const fake = new FakeAgent({});
    const err = new StringWritable();

    const exitCode = await runCli(["run", "quick-update", app], {
      agent: fake,
      stderr: err,
      stdin: ttyStdin("n\n"),
    });

    expect(exitCode).toBe(0);
    expect(err.text).toContain("auto-approved");
    expect(err.text).not.toContain("Continue?");
  });

  test("install-rules never asks: it runs no agent", async () => {
    const { app } = await tmpUnchangedApp("norules");
    const err = new StringWritable();

    const exitCode = await runCli(["install-rules", app], {
      stderr: err,
      stdin: ttyStdin("n\n"),
    });

    expect(exitCode).toBe(0);
    expect(err.text).not.toContain("Cost notice:");
  });
});
