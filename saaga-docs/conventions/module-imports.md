---
title: Module Imports
type: convention
last_verified: 2026-09-01
---

# Module Imports

- **Rule.** Node builtins carry the `node:` prefix, and a relative specifier always ends
  in `.js` even though the file on disk is `.ts` — the package is NodeNext ESM, so the
  specifier names the emitted file, not the source.
- **Do.** `import { resolve } from "node:path";` and `import { PROMPTS_DIR } from "./paths.js";`
- **Don't.** `import { resolve } from "path";` or `import { PROMPTS_DIR } from "./paths";`
- **Rule.** One import block at the top of the file, in three groups: builtins, then
  external packages, then relative specifiers. Ordering *within* a group is not held to —
  `src/cli.ts` and `src/engine/runner.ts` are both unsorted — so do not read one into it.
- **Do.** `node:crypto`, `node:fs/promises`, `node:path`, `execa`, `../agent/types.js`,
  `./probes.js` — the block at the head of `src/doctor/full-probes.ts`.
- **Don't.** Place an external package import after a relative one, or open a second
  import block further down the file.
- **Applies to.** `src/**`, `tests/**`, `eval/**`. No ESLint import plugin is configured
  in `eslint.config.js`, so nothing checks any of this mechanically — review is the only
  enforcement, which is why it is written down.
