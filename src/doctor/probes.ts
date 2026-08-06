import type { Backend } from "../cli/backend.js";

export type ProbeLevel = "fast" | "full";

export interface ProbeDefinition {
  id: string;
  description: string;
  level: ProbeLevel;
  backends?: Backend[];
}

/**
 * Why a probe failed, established by rerunning it without the profile.
 *
 * - `policy-denial`: it succeeds unrestricted, so our profile caused the
 *   failure and is too tight for this backend or CLI version.
 * - `backend-failure`: it fails either way, so the profile is not implicated
 *   and the CLI, credentials, or environment is at fault.
 */
export type ProbeClassification = "policy-denial" | "backend-failure";

export interface ProbeRunResult {
  probeId: string;
  backend: Backend;
  status: "pass" | "fail" | "skip";
  classification?: ProbeClassification;
  exitCode: number;
  elapsed: number;
  error?: string;
}

/**
 * The probe catalogue, shipped as data. IDs are stable across versions
 * and used by CI assertions and `--probe` filtering.
 */
export const PROBE_CATALOGUE: ProbeDefinition[] = [
  {
    id: "version",
    description: "CLI answers a version query; record the string.",
    level: "fast",
  },
  {
    id: "handshake",
    description: "Reply with a nonce. Asserts exit 0 and nonce reaches the log.",
    level: "full",
  },
  {
    id: "write-in-cwd",
    description: "Create a file in the docs tree containing a nonce.",
    level: "full",
  },
  {
    id: "read-from-cwd",
    description: "Copy a seeded nonce file to verify read path.",
    level: "full",
  },
  {
    id: "read-gitignored",
    description: "Read a gitignored file to verify .gitignore workaround.",
    level: "full",
  },
  {
    id: "write-run-dir",
    description: "Write into the .saaga-runs/ run directory.",
    level: "full",
  },
  {
    id: "unknown-model-fails",
    description: "Invoke with a bogus model, assert non-zero exit.",
    level: "fast",
  },
  {
    id: "read-outside-workspace-denied",
    description: "Files outside the workspace and run dir are unreadable.",
    level: "full",
  },
  {
    id: "write-outside-workspace-denied",
    description: "Writes outside the workspace and run dir are refused.",
    level: "full",
  },
  {
    id: "arbitrary-shell-denied",
    description: "A non-git shell command cannot be run.",
    level: "full",
  },
  {
    id: "write-source-denied",
    description: "Writing to src/ is refused under restricted profile.",
    level: "full",
    backends: ["cursor", "claude"],
  },
  {
    id: "rule-files-denied",
    description: "AGENTS.md and rule files are unwritable.",
    level: "full",
    backends: ["cursor", "claude"],
  },
  {
    id: "baseline-denied",
    description: "BASELINE file is unwritable.",
    level: "full",
    backends: ["cursor", "claude"],
  },
  {
    id: "read-only-git-allowed",
    description: "git log runs under the read-only git allowance.",
    level: "full",
    backends: ["cursor"],
  },
  {
    id: "git-mutation-denied",
    description: "git commit is refused.",
    level: "full",
    backends: ["cursor"],
  },
  {
    id: "claude/tool-surface",
    description: "Only the file tools are available; no web, subagents, or MCP.",
    level: "full",
    backends: ["claude"],
  },
  {
    id: "claude/absolute-path-anchoring",
    description: "Double-slash absolute paths work in Edit rules.",
    level: "full",
    backends: ["claude"],
  },
  {
    id: "claude/run-dir-writable",
    description: "Edit rule makes the in-workspace run dir writable.",
    level: "full",
    backends: ["claude"],
  },
];
