---
title: Error Messages
type: convention
last_verified: 2026-09-01
---

# Error Messages

- **Rule.** A validation failure names the offending key in single quotes, then
  `must be a <type>`, with no trailing period. Config errors prefix the file path.
- **Do.** `'loop.max' must be a positive integer`, and
  `.saaga/config.yaml: 'backends.claude.models.high' must be a string`.
- **Don't.** `Invalid loop max.` — no key, no expected type, and a trailing period.
- **Rule.** A subsystem whose failure a caller must tell apart from any other exports a
  named `Error` subclass that sets `this.name` in its constructor: `ConfigError`,
  `BackendError`, `ExpressionError`, `SaagaRulesError`, the four template errors, and the
  runner's agent-step errors.
- **Rule.** `NonResumableError` is a marker rather than a category — `src/cli.ts` tests for
  it to suppress the resume hint on a failure that resuming would only reproduce.
- **Do.** Throw it when the failure is decided by an input the journal replays unchanged.
- **Don't.** Throw it for a crashed agent or a transient tool error; those resume fine.
- **Applies to.** The two rules govern different layers and are independent. Phrasing:
  `src/engine/loader.ts` (bare `Error`) and `src/cli/config.ts` (`ConfigError`). Subclasses:
  `src/cli/`, `src/templates.ts`, `src/engine/`, `src/saaga-rules.ts`. Elsewhere —
  `src/scripts/` above all — a bare `Error` is the norm.
