---
title: Run Context
type: concept
sources:
  - src/run-context.ts
  - src/run-manifest.ts
  - src/cli.ts
terms:
  - run id
  - run directory
  - run manifest
last_verified: 2026-09-01
---

# Run Context

## Business Definition

One invocation of a flow against one application, given an identity and a private
directory to work in: the **run id**, and `<appPath>/.saaga-runs/<run-id>/`, where
everything a run produces that is not the corpus lands — its log, manifest, step journal,
rendered prompts and each flow's intermediate artifacts.

A run id is `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`, never parsed back
apart because an application name may itself contain dashes; the manifest is what a later
invocation reads instead. A context also carries the run's date twice: `date` (`YYYYMMDD`,
as in the id) and `isoDate` (`YYYY-MM-DD`, the form document frontmatter uses).

## Data Storage

| Artifact | Field/Property | Purpose |
|--------|-------|---------|
| `run.json` | `runId`, `flow`, `flowHash` | Which run this is, and the flow definition it started with |
| `run.json` | `app`, `appPath`, `docsDir` | The target it was launched against |
| `run.json` | `backend`, `models` | The [backend and model pins](./backend-resolution.md) to reapply on resume |
| `run.json` | `initialScope` | The scope `runFlow()` was started with, reused verbatim on resume |
| `run.json` | `status`, `pid`, `startedAt`, `resumedAt`, `lastError` | The outcome so far, and who last owned the run |

`status` is `running`, `interrupted`, `failed` or `completed`; `RESUMABLE_STATUSES` names
the middle two. Writes go through a temporary file and a rename, so a process killed
mid-write leaves the previous manifest intact. Step-level progress lives beside it in the
journal — see [flow execution](../features/flow-execution.md), which is what lets a
resumed run skip the steps already done.

A manifest qualifies for resume when its status is resumable, its `flowHash` still matches
the flow on disk, and — for `--resume <id>` — its `flow` matches any flow name given. A
`completed` run never qualifies. Only `--resume <id>`, which reads the named manifest
directly, ever sees a `running` run: it resumes one whose `pid` `isProcessAlive()` reports
gone, with a warning. `--continue` picks the newest resumable run by `startedAt`, skipping
every directory under `.saaga-runs/` without a readable manifest — older runs, doctor logs.
The flags themselves belong to [the CLI](../features/cli-entry-point.md).

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `run-context` | `createRunContext()` | Allocates an id and creates `<appPath>/.saaga-runs/<run-id>/` |
| `run-context` | `reopenRunContext()` | Rebuilds an earlier run's context; fails if its directory is gone |
| `run-context` | `RunContext` | `app`, `appPath`, `subcommand`, `runId`, `runDir`, `date`, `isoDate` |
| `run-manifest` | `RunManifest`, `RunStatus` | The manifest shape and its four statuses |
| `run-manifest` | `readManifest()`, `writeManifest()` | Load and atomically store `<runDir>/run.json` |
| `run-manifest` | `manifestModels()` | The model pins to reapply, falling back to the legacy single-model field |
| `run-manifest` | `findResumableRun()` | Newest resumable run under an app, optionally per flow |
| `run-manifest` | `isProcessAlive()` | Whether a manifest's `pid` still exists |
| `run-manifest` | `RESUMABLE_STATUSES`, `MANIFEST_FILE` | The resumable statuses, and `run.json` |

## Reference Implementations

- `src/run-context.ts` - id generation, directory creation, and reopening
- `src/run-manifest.ts` - the manifest, its atomic write, and resumable-run discovery
- `tests/run-context.test.ts` - the id format and reopen behaviour
- `tests/cli/resume.test.ts` - end-to-end resume, including every refused case

## Related Concepts

- [Backend Resolution](./backend-resolution.md)
- [Feature: Flow Execution](../features/flow-execution.md)
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
