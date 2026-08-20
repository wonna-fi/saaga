---
generated: 2026-08-20T01:10:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/INDEX.md
  - saaga-docs/concepts/backend-resolution.md
  - saaga-docs/concepts/project-configuration.md
  - saaga-docs/concepts/agent-interface.md
  - saaga-docs/features/cli-entry-point.md
  - saaga-docs/features/doctor.md
  - saaga-docs/features/agent-invocation.md
  - saaga-docs/features/quick-update-workflow.md
  - saaga-docs/patterns/adding-agent-backends.md
  - saaga-docs/ARCHITECTURE.md
confidence: high
---

## What changed

Commit `feat: replace fixed model tiers with open per-backend models map (#39)` replaced the fixed `--model-low` / `--model-medium` / `--model-high` flags and `modelLow` / `modelMedium` / `modelHigh` config fields with an open model-key map: repeatable `--model <key>=<model>` and `backends.<backend>.models` in `.saaga/config.yaml`. Built-in keys remain `low` (doctor), `medium` (quick-update), and `high` (init/update/verify-quick-updates); custom keys are allowed with no built-in defaults. Related API renames: `resolveModelForTier` → `resolveModel`, `ModelTier` → `ModelKey`/`BuiltinModelKey`, `BackendModels` → `BackendConfig`. `DoctorOptions.model` became `modelOverrides`. A new `CLAUDE.md` symlink to `AGENTS.md` was also added; it does not change Saaga runtime behavior beyond existing rule-target documentation.

## What was updated

- **concepts/backend-resolution.md** — Rewrote model resolution around open model keys, new exports (`parseModelOverrides`, `mergeModelOverrides`, `resolveModel`, key validation), and updated defaults/error tables.
- **concepts/project-configuration.md** — Replaced `BackendModels` tier fields with `BackendConfig.models`; documented legacy-field migration errors and new validation paths.
- **concepts/agent-interface.md** — Updated configuration sources and `resolveModel` service entry.
- **concepts/INDEX.md** — Clarified Backend Resolution description for model keys.
- **features/cli-entry-point.md** — Global `--model` flag, quick-update/doctor flows, logging, and services table.
- **features/doctor.md** — Probe model selection via `low` key and `modelOverrides`.
- **features/agent-invocation.md** — Model precedence chain and `defaultBackend` (fixed stale `backend` field name).
- **features/quick-update-workflow.md** — Medium key overrides and `resolveModel` references.
- **patterns/adding-agent-backends.md** — `DEFAULT_BACKEND_MODELS` keyed by `low`/`medium`/`high`.
- **ARCHITECTURE.md** — CLI flags, config/backend module exports, and `DoctorOptions` shape.

## Uncertainty areas

- **Per-step model keys**: `resolveAgent()` comments note per-step model keys as a later change; docs describe current command-level key selection only. Flag if flows start selecting keys per step.
- **CLAUDE.md symlink**: Listed as a new file in the changes report but not documented as a Saaga feature (install-rules already covers `CLAUDE.md` as a rule target). Confirm no additional project-convention note is desired.
- **ARCHITECTURE.md Doctor section**: Spot-checked `DoctorOptions`; other doctor subsections were not re-audited line-by-line for leftover tier wording.
