---
generated: 2026-08-09T19:35:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/project-configuration.md
  - saaga-docs/concepts/backend-resolution.md
  - saaga-docs/features/cli-entry-point.md
  - saaga-docs/features/doctor.md
confidence: high
---

## What changed

The commit `015c6f8` ("feat: replace flat model config with per-backend tiered model system") introduced a tiered model configuration system. Key breaking changes:

- `SaagaConfig.backend` → `SaagaConfig.defaultBackend`
- `SaagaConfig.model` and `SaagaConfig.quickModel` removed; replaced by `SaagaConfig.backends?: Partial<Record<Backend, BackendModels>>` where `BackendModels` has `modelLow?`, `modelMedium?`, `modelHigh?`
- CLI `--model` flag replaced by `--model-low`, `--model-medium`, `--model-high`
- `defaultModelFor()` and `defaultQuickModelFor()` functions removed; replaced by `resolveModelForTier(backend, tier, configModels?)`
- New `ModelTier` type: `"low" | "medium" | "high"`
- Doctor uses low-tier model (config `backends.<backend>.modelLow`); environment variable `SAAGA_PROBE_*_MODEL` removed
- Doctor `DoctorOptions` gains `backendModels?: Partial<Record<Backend, BackendModels>>`

Runtime behavior is unchanged: the same models are selected for the same commands via the new resolution chain.

## What was updated

- **`saaga-docs/concepts/project-configuration.md`**: Rewrote `SaagaConfig` data storage table to reflect `defaultBackend` replacing `backend`, and the new `backends`/`BackendModels` fields replacing flat `model`/`quickModel`. Updated `BackendModels` interface to the exported API. Updated the config file example. Updated the resolution chains table to show tier-based model resolution. Updated the error handling table for new validation paths. Updated Key Services/Functions to add `BackendModels` and remove stale entries. Updated Related Concepts link text.

- **`saaga-docs/concepts/backend-resolution.md`**: Rewrote the model resolution section to describe the three-tier system (`low/medium/high`). Added `ModelTier` to exported types table. Replaced `DEFAULT_MODELS`/`DEFAULT_QUICK_MODELS` internal constants with `DEFAULT_BACKEND_MODELS`/`TIER_KEY`. Replaced `defaultModelFor()`/`defaultQuickModelFor()` in Key Services/Functions with `resolveModelForTier()` and `ModelTier`. Added a built-in default models table per backend and tier. Updated `resolveAgent()` internal description. Updated Related Concepts.

- **`saaga-docs/features/cli-entry-point.md`**: Replaced `--model` in the Global Flags table with `--model-low`, `--model-medium`, and `--model-high`. Updated the quick-update user flow to describe medium-tier selection. Updated doctor user flow to show `backendModels` in `DoctorOptions`. Replaced `defaultModelFor()`/`defaultQuickModelFor()` rows in Services/Functions with `resolveModelForTier()` and `ModelTier`. Updated `SaagaConfig` description to reflect new field names. Updated `resolveAgent()` internal description.

- **`saaga-docs/features/doctor.md`**: Rewrote "Probe Model Selection" to describe low-tier model resolution via `--model-low` flag → `config.backends.<backend>.modelLow` → built-in defaults (removing env var reference). Updated `DoctorOptions` data model to include `backendModels`. Updated CLI Registration note to replace `-m, --model` with `--model-low`. Updated "Adding a New Backend" extension guide to point to `DEFAULT_BACKEND_MODELS` instead of the removed `DEFAULT_PROBE_MODELS`.

## Uncertainty areas

None significant. All changes were directly verifiable from the source code. The `DEFAULT_BACKEND_MODELS` constant and all model strings were confirmed in `src/cli/backend.ts`.
