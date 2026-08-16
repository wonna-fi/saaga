---
generated: 2026-08-16T08:16:41Z
verified: false
docs_touched:
  - saaga-docs/features/doctor.md
  - saaga-docs/concepts/backend-resolution.md
  - saaga-docs/features/agent-invocation.md
  - saaga-docs/features/quick-update-workflow.md
  - saaga-docs/concepts/project-configuration.md
  - saaga-docs/patterns/adding-agent-backends.md
  - saaga-docs/ARCHITECTURE.md
confidence: high
---

## What changed

Doctor gained a new fast-tier `required-flags` probe (`src/doctor/required-flags.ts`) that checks CLI help for every flag Saaga passes, plus full-tier capability retry/`transient` classification. Built-in model defaults in `src/cli/backend.ts` were updated across all backends/tiers. GitHub workflows were reorganized (`backend-drift.yml` removed; `doctor-fast.yml` / `doctor-full.yml` and scheduled quick-update workflows added) — domain docs do not document CI workflow files, so those were not mirrored beyond doctor behavior already covered.

## What was updated

- **`saaga-docs/features/doctor.md`**: Documented `required-flags` probe, `REQUIRED_CLI_FLAGS` / `findMissingRequiredFlags()`, `transient` classification and `CAPABILITY_RETRIES`, updated low-tier model defaults, and extended the “Adding a New Backend” guide.
- **`saaga-docs/concepts/backend-resolution.md`**: Refreshed the built-in default models table to match `DEFAULT_BACKEND_MODELS`.
- **`saaga-docs/features/agent-invocation.md`**: Fixed model resolution to the three-tier flag/config chain and updated default model strings / `resolveModelForTier()`.
- **`saaga-docs/features/quick-update-workflow.md`**: Replaced stale `quickModel` / `defaultQuickModelFor()` references with medium-tier resolution.
- **`saaga-docs/concepts/project-configuration.md`**: Updated the config example’s `modelMedium` to the current cursor default.
- **`saaga-docs/patterns/adding-agent-backends.md`**: Updated registration steps for `DEFAULT_BACKEND_MODELS` and `REQUIRED_CLI_FLAGS`.
- **`saaga-docs/ARCHITECTURE.md`**: Updated Backend exports/model resolution, Doctor probe catalogue/`ProbeClassification`/`ProbeRunResult`, added Required Flags subsection, documented capability retries, and wired `doctor/required-flags` into the module graph.

## Uncertainty areas

- **CI workflows**: `.github/workflows/doctor-fast.yml`, `doctor-full.yml`, `quick-update-nightly.yml`, and `verify-quick-updates-weekly.yml` are new operational surfaces but have no dedicated domain docs. If `verify-quick-updates` expects CI coverage, consider a short Architecture or Features note — not added here to keep scope tight.
- **`REQUIRED_CLI_FLAGS` completeness**: Documented as “sourced from each adapter’s buildArgs/run path”; did not cross-audit every adapter flag against the constant line-by-line beyond trusting the module comment and probe purpose.
