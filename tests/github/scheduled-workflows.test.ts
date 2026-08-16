import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  id?: string;
}

interface WorkflowJob {
  "runs-on": string;
  "timeout-minutes": number;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

interface Workflow {
  name: string;
  on: {
    workflow_dispatch?: unknown;
    schedule?: Array<{ cron: string }>;
  };
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, WorkflowJob>;
}

async function loadWorkflow(name: string): Promise<Workflow> {
  const raw = await readFile(
    resolve(ROOT, ".github", "workflows", name),
    "utf8",
  );
  return parseYaml(raw) as Workflow;
}

function allRunCommands(job: WorkflowJob): string {
  return job.steps
    .filter((s) => s.run)
    .map((s) => s.run)
    .join("\n");
}

// ── Nightly workflow ───────────────────────────────────────────────
describe("quick-update-nightly.yml", () => {
  test("exists", async () => {
    const p = resolve(
      ROOT,
      ".github",
      "workflows",
      "quick-update-nightly.yml",
    );
    const s = await stat(p);
    expect(s.isFile()).toBe(true);
  });

  test("scheduled every night except Monday", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const crons = wf.on.schedule?.map((s) => s.cron) ?? [];
    expect(crons).toHaveLength(1);
    const [cron] = crons;
    // Days: 0=Sun,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat — Monday (1) excluded
    expect(cron).toBe("0 0 * * 0,2,3,4,5,6");
  });

  test("supports manual dispatch", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  test("runs from repository source via tsx", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toContain("npx tsx src/cli.ts");
    expect(runs).not.toContain("@wonna/saaga@latest");
  });

  test("passes --ci to saaga", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toMatch(/quick-update .* --ci/);
  });

  test("does not pass --backend or --yes (config is source of truth)", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).not.toContain("--backend");
    expect(runs).not.toContain("--yes");
  });

  test("provides CURSOR_API_KEY to the saaga step", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const saagaStep = job.steps.find((s) =>
      s.run?.includes("quick-update"),
    );
    expect(saagaStep?.env?.CURSOR_API_KEY).toBe(
      "${{ secrets.CURSOR_API_KEY }}",
    );
  });

  test("invokes shared publish script", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toContain("publish-saaga-changes.sh");
  });

  test("generates App token before publishing", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const tokenIdx = job.steps.findIndex((s) =>
      s.uses?.startsWith("actions/create-github-app-token"),
    );
    const publishIdx = job.steps.findIndex((s) =>
      s.run?.includes("publish-saaga-changes.sh"),
    );
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(tokenIdx);
  });

  test("shares concurrency group with weekly workflow", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    expect(wf.concurrency?.group).toBe("saaga-maintenance");
    expect(wf.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  test("checkout does not persist GITHUB_TOKEN credentials", async () => {
    const wf = await loadWorkflow("quick-update-nightly.yml");
    const job = Object.values(wf.jobs)[0];
    const checkout = job.steps.find((s) =>
      s.uses?.startsWith("actions/checkout"),
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });
});

// ── Weekly workflow ────────────────────────────────────────────────
describe("verify-quick-updates-weekly.yml", () => {
  test("exists", async () => {
    const p = resolve(
      ROOT,
      ".github",
      "workflows",
      "verify-quick-updates-weekly.yml",
    );
    const s = await stat(p);
    expect(s.isFile()).toBe(true);
  });

  test("scheduled Monday at 00:00 UTC", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const crons = wf.on.schedule?.map((s) => s.cron) ?? [];
    expect(crons).toHaveLength(1);
    expect(crons[0]).toBe("0 0 * * 1");
  });

  test("supports manual dispatch", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  test("runs quick-update before verify-quick-updates", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    const quickIdx = runs.indexOf("quick-update");
    const verifyIdx = runs.indexOf("verify-quick-updates");
    expect(quickIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(quickIdx);
  });

  test("passes --ci to both commands", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toMatch(/quick-update .* --ci/);
    expect(runs).toMatch(/verify-quick-updates .* --ci/);
  });

  test("runs from repository source via tsx", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toContain("npx tsx src/cli.ts");
    expect(runs).not.toContain("@wonna/saaga@latest");
  });

  test("provides CURSOR_API_KEY", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const saagaStep = job.steps.find((s) =>
      s.run?.includes("quick-update"),
    );
    expect(saagaStep?.env?.CURSOR_API_KEY).toBe(
      "${{ secrets.CURSOR_API_KEY }}",
    );
  });

  test("invokes shared publish script", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const runs = allRunCommands(job);
    expect(runs).toContain("publish-saaga-changes.sh");
  });

  test("shares concurrency group with nightly workflow", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    expect(wf.concurrency?.group).toBe("saaga-maintenance");
    expect(wf.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  test("has longer timeout than nightly", async () => {
    const nightly = await loadWorkflow("quick-update-nightly.yml");
    const weekly = await loadWorkflow("verify-quick-updates-weekly.yml");
    const nightlyTimeout =
      Object.values(nightly.jobs)[0]["timeout-minutes"];
    const weeklyTimeout =
      Object.values(weekly.jobs)[0]["timeout-minutes"];
    expect(weeklyTimeout).toBeGreaterThan(nightlyTimeout);
  });

  test("checkout does not persist GITHUB_TOKEN credentials", async () => {
    const wf = await loadWorkflow("verify-quick-updates-weekly.yml");
    const job = Object.values(wf.jobs)[0];
    const checkout = job.steps.find((s) =>
      s.uses?.startsWith("actions/checkout"),
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });
});

// ── Cron coverage ──────────────────────────────────────────────────
describe("schedule coverage", () => {
  test("nightly + weekly cover all seven days", async () => {
    const nightly = await loadWorkflow("quick-update-nightly.yml");
    const weekly = await loadWorkflow("verify-quick-updates-weekly.yml");
    const nightlyCron = nightly.on.schedule![0].cron;
    const weeklyCron = weekly.on.schedule![0].cron;

    const nightlyDays = nightlyCron.split(" ")[4].split(",").map(Number);
    const weeklyDays = weeklyCron.split(" ")[4].split(",").map(Number);
    const allDays = [...nightlyDays, ...weeklyDays].sort();
    expect(allDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

// ── Publish script ─────────────────────────────────────────────────
describe("publish-saaga-changes.sh", () => {
  test("exists and is executable", async () => {
    const p = resolve(ROOT, ".github", "scripts", "publish-saaga-changes.sh");
    const s = await stat(p);
    expect(s.isFile()).toBe(true);
    expect(s.mode & 0o100).toBeTruthy();
  });

  test("classifies changes by saaga-docs/ prefix", async () => {
    const content = await readFile(
      resolve(ROOT, ".github", "scripts", "publish-saaga-changes.sh"),
      "utf8",
    );
    expect(content).toContain("saaga-docs/");
    expect(content).toContain("DOCS_ONLY");
  });

  test("fails on stale main", async () => {
    const content = await readFile(
      resolve(ROOT, ".github", "scripts", "publish-saaga-changes.sh"),
      "utf8",
    );
    expect(content).toContain("origin/main");
    expect(content).toMatch(/LOCAL_SHA.*REMOTE_SHA|REMOTE_SHA.*LOCAL_SHA/s);
  });
});
