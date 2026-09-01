---
title: "Feature: Doctor"
type: feature
sources:
  - src/doctor/*.ts
  - src/cli.ts
terms:
  - probe
last_verified: 2026-09-01
---

# Feature: Doctor

## Overview

Whether a backend's CLI is installed, still accepts the flags Saaga passes it, and can do the work
a flow will ask of it — established before a run spends anything finding out. A fast tier makes no
model calls; a full tier drives a real agent through a throwaway repository.

## Key Concepts

Before working with this feature, understand these concepts:
- [Backend Resolution](../concepts/backend-resolution.md)
- [Agent Interface](../concepts/agent-interface.md)
- [Agent Permissions](../concepts/agent-permissions.md)

## Functional Specification

### Mechanism

1. The backends probed are the one `--backend` names, or all three when absent. Each is looked up
   with `which`: a binary not on `PATH` is unavailable and probed no further, otherwise the first
   line of its `--version` output is captured.
2. **Fast tier.** Only the three fast-level probes run — no full-tier probe appears in the result at
   all — and nothing is spent: what executes asks the CLI for its version and its help text, and
   `unknown-model-fails` is recorded `skip` because it needs a model call.
3. **Full tier.** The fast probes run first, with `unknown-model-fails` executed for real this time.
   Then a scratch repository is created, an [`Agent`](../concepts/agent-interface.md) is built at
   the `low` model key, each applicable full probe runs against it in turn — roughly a model call
   per probe per backend — and those results are appended to the fast ones. The repository is
   deleted afterwards whatever happens.
4. A probe builds its prompt from the scratch repo's paths and nonces, runs the agent under a
   [permission profile](../concepts/agent-permissions.md) for that repo with a 120-second timeout,
   then asserts on the exit code, on what landed on disk, or on the
   [event stream](../concepts/agent-events.md).
5. A failed *capability* probe is retried twice under the same profile; passing there classifies it
   `transient` — flaky, not broken. One still failing is rerun **without** the profile: succeeding
   unrestricted makes it a `policy-denial` (the profile is too tight here), failing again a
   `backend-failure`. A *restriction* probe should fail unrestricted, so it is never diagnosed
   this way.

The catalogue ships as data and its ids are stable — they are what `--probe` filters on:

| Probes | Tier and backends | What they establish |
|---|---|---|
| `version`, `required-flags`, `unknown-model-fails` | fast, but the last is skipped at the fast tier — it needs a model call | The CLI answers, its help still names every flag Saaga passes, and a bogus model is rejected rather than silently substituted |
| `handshake`, `write-in-cwd`, `read-from-cwd`, `read-gitignored`, `write-run-dir` | full | The agent can do what a flow needs: reply, write the docs tree, read source, read a gitignored file, write the run directory |
| `read-outside-workspace-denied`, `write-outside-workspace-denied`, `arbitrary-shell-denied` | full | The workspace boundary and the shell allowance hold |
| `write-source-denied`, `rule-files-denied`, `baseline-denied` | full, cursor + claude | Source, rule files and `BASELINE` survive a run untouched |
| `restricted-shell-utility-allowed`, `read-only-git-allowed`, `git-mutation-denied` | full, all three | The restricted shell passes `pwd` and `git log` and refuses `git commit` |
| `claude/tool-surface`, `claude/absolute-path-anchoring`, `claude/run-dir-writable` | full, claude only | Claude's tool list has not drifted, and its absolute-path rules reach the run directory |

### Validation Rules

- `required-flags` reads the CLI's help — `--help`, then `-h`, accepting output printed beside a
  non-zero exit — and matches each flag token-aware, so `-p` does not match inside `--print`. A
  missing flag fails: the argv Saaga builds would be rejected at run time.
- A restriction probe asserts on a value the agent could not have produced another way, so
  `arbitrary-shell-denied` looks for the real `sha256sum` digest rather than for the file.
- A probe that names `backends` runs only for those; the rest run for every backend probed, and
  `--probe` matches ids exactly at both tiers.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Binary present, `--version` fails | Still available; version reported as `unknown` |
| Every applicable probe filtered out or skipped | Exit 0 — nothing was there to fail |
| `run` with an injected agent | Preflight is skipped; it runs only when a real backend was resolved |

## Technical Implementation

### Data Model

| Type/Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `DoctorResult` | `schemaVersion`, `backends`, `exitCode`, `logDir` | The whole report, printed verbatim under `--json`; each `DoctorBackendResult` carries `available`, `reason`, `version` and its probes |
| `ProbeRunResult` | `probeId`, `status`, `classification`, `exitCode`, `elapsed`, `error`, `retries` | One probe's verdict; `classification` picks the explanatory line printed under a failure |
| `<cwd>/.saaga-runs/doctor/<timestamp>/<backend>.log` | Agent output | Full-tier transcripts, surviving the scratch repo's deletion |

Exit codes: **0** every probe passed or none ran, **1** at least one failed, **2** no probed
backend was available; the subcommand's flags are [the CLI's](./cli-entry-point.md).

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `doctor/index` | `runDoctor()`, `formatDoctorResult()`, `DoctorOptions`, `DoctorResult`, `DoctorBackendResult` | Run the requested tier and compute the exit code, render the human report with its classification lines, and the shapes both use |
| `doctor/probes` | `PROBE_CATALOGUE`, `ProbeDefinition`, `ProbeRunResult`, `ProbeClassification` | The catalogue as data, and the result vocabulary the whole feature reports in |
| `doctor/full-probes` | `runFullSideEffectProbes()`, `FullProbeRunOptions` | The full tier: scratch repo, per-probe assertions, retries, unrestricted diagnosis |
| `doctor/required-flags` | `findMissingRequiredFlags()`, `REQUIRED_CLI_FLAGS` | The per-backend flag expectations and the token-aware match |
| `doctor/scratch-repo` | `createScratchRepo()`, `ScratchRepo` | A one-commit git repo in `tmpdir` with `AGENTS.md`, a `BASELINE` and a run directory, plus three fixtures a probe asserts on by nonce — a source file, a gitignored build file and an out-of-workspace secret |
| `doctor/preflight` | `runPreflight()`, `PreflightResult` | The fast tier for one backend reduced to a boolean; never throws |

## Integration Points

- **Depends on**: the [backend factory](../concepts/backend-resolution.md) for the CLI command,
  model and agent, and [`buildProfile`](../concepts/agent-permissions.md) for the profile.
- **Used by**: the `run` subcommand, which preflights after cost approval and aborts with exit 1
  before creating a run directory — see [CLI Entry Point](./cli-entry-point.md) — and CI.
- **External systems**: the backend CLIs, and `git` for the scratch repository.

## Extension Guide

A fast probe is a `PROBE_CATALOGUE` entry plus a branch in the fast-tier dispatch; an entry with no
branch is reported `skip`. A full probe is an entry in both the catalogue and the full-probe list,
where `kind` decides whether a failure is diagnosable — mark it `capability` only when succeeding
unrestricted would prove the profile at fault. Set `wantsEvents` when the assertion reads the
[event stream](../concepts/agent-events.md) rather than the filesystem, and give any new
scratch-repo fixture a nonce so an assertion can tell real work from a coincidence.
