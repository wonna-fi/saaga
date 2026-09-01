---
title: File Layout
type: convention
last_verified: 2026-09-01
---

# File Layout

- **Rule.** Module filenames are kebab-case. A built-in script lives at
  `src/scripts/<id>.ts`, and its key in `defaultScriptRegistry` is that filename stem.
- **Do.** `src/scripts/check-plan-budget.ts`, registered under `"check-plan-budget"`.
- **Don't.** Register a handler under a key that differs from the file it lives in.
- **Rule.** A module's unit test mirrors only its top-level directory under `src/`: a deeper
  path flattens, so `src/engine/primitives/foreach.ts` is tested by
  `tests/engine/foreach.test.ts`, never `tests/engine/primitives/foreach.test.ts`. Tests that
  cover no single module — `tests/cli/init.test.ts`, `tests/engine/resume.test.ts`, `tests/flows.test.ts` — mirror nothing.
- **Rule.** A flow is `flows/<name>.flow.yaml`, and its `name:` field is the filename stem.
- **Do.** `flows/verify-quick-updates.flow.yaml` declaring `name: verify-quick-updates`.
- **Rule.** A prompt an `agent` step names is `prompts/<name>.md`, referenced without its
  extension; a fragment shared between prompts is `prompts/partials/<name>.md`, referenced
  with it.
- **Do.** `prompt: slice-doc` for `prompts/slice-doc.md`, and
  `{include:partials/lod-policy.md}` for `prompts/partials/lod-policy.md`.
- **Don't.** Put a top-level template under `partials/`, or name a partial as `agent.prompt`.
- **Applies to.** `src/**`, `tests/**`, `flows/**`, `prompts/**`.
