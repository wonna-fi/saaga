---
generated: 2026-09-23T00:00:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-events.md
  - saaga-docs/concepts/agent-interface.md
  - saaga-docs/concepts/agent-permissions.md
  - saaga-docs/concepts/backend-resolution.md
  - saaga-docs/concepts/project-configuration.md
  - saaga-docs/features/doctor.md
confidence: high
---

## What changed

`feat(kiro): add kiro-cli backend support` adds `kiro` as a fourth `--backend`, following the
existing pattern in [Adding Agent Backends](../../patterns/adding-agent-backends.md): a new
`KiroAgent` (`src/agent/kiro-agent.ts`), a stream-json event parser, permission-profile
translation into kiro's capability-based rules, a dedicated account-check probe module
(`src/doctor/kiro-probes.ts`), and the usual updates to `src/cli/backend.ts`,
`src/cli/config.ts`, and the four doctor files that carry per-backend literal lists.

## What was updated

- `concepts/agent-interface.md` — added the `kiro` row to the backend/binary/flags table, a
  paragraph on `KiroAgent`'s detached-process-group signal handling and login-flow guard
  (previously undocumented for any backend, and load-bearing per the source comments), the
  `agent/kiro-agent` row in Key Services/Functions, and `src/agent/kiro-agent.ts` to `sources`.
- `concepts/agent-permissions.md` — added the `kiro` row to the per-backend translation table
  and a paragraph on its deny-wins-with-exclude-lists structure versus cursor's ancestor-path
  carve-out, plus `src/agent/kiro-agent.ts` to `sources`.
- `concepts/agent-events.md` — added kiro to the parser table and to the "how a refusal is
  marked" sentence, plus `src/agent/kiro-agent.ts` to `sources`.
- `concepts/backend-resolution.md` — the `Backend` union sentence now lists `kiro`.
- `concepts/project-configuration.md` — the `backends` config field's allowed keys now list
  `kiro`.
- `features/doctor.md` — added the `kiro/auth` / `kiro/models-available` probe row, updated the
  backend counts in two other rows (`cursor + claude` → `cursor + claude + kiro`, "all three" →
  "all four") and in the "backends probed" sentence, added the `doctor/kiro-probes` module row,
  and added an edge case for the `KIRO_API_KEY`-while-logged-in ambiguity that makes
  `kiro/models-available` report `skip`.

Not touched: `patterns/adding-agent-backends.md` is a leaf document (only INDEX/GLOSSARY link
to it) already sitting at 120 lines, at the top of its likely Supporting band — its content is
generic (uses a hypothetical "gemini" backend) and stayed accurate without changes, so it was
left alone rather than grown with a fourth reference implementation. Root `README.md`'s kiro
setup instructions are user-facing docs outside the corpus's source set and aren't a documented
source for any existing concept/pattern/feature file.

## Uncertainty areas

- None of the specific factual claims added (rule shapes, signal names, probe backend lists)
  are in doubt — each was checked directly against `src/agent/kiro-agent.ts`,
  `src/doctor/probes.ts`, and `src/doctor/full-probes.ts`. Lower confidence only on the
  editorial call to leave `adding-agent-backends.md` unchanged given its likely tier/budget;
  `verify-quick-updates` should confirm that's the right call rather than adding a kiro
  reference-implementation row there.
