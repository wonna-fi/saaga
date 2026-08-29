# Implementation plan: Task 1 — Frontmatter and layout-version foundation

Trello: https://trello.com/c/CFptBWxN · Canonical scope: `plans/beta-1.0-documentation-format-tasks.md`, Task 1 (Track A) + the "Amendment: version-gate states" addendum.

## Background — why this exists

Staleness is the one proven failure mode of the documentation pipeline: 4 confirmed stale claims survived multiple update passes. To fix that later (task 7), each generated doc needs machine-readable metadata: when it was last verified and which source files it covers. This task adds that metadata (YAML frontmatter, field names OKF v0.1-compatible so OpenWiki's visualizer can type the nodes) plus the parsing code for it.

Separately, the verify loop compares document structure against templates. An upgraded Saaga (new templates) run against an old-format corpus would structurally fail every touched doc and burn tokens rewriting them. So the corpus gets a **layout version**, and every flow gets a **version gate** as its first step that turns the mismatch into a clear, cheap error. It is a gate, not a migration framework.

The two axes stay distinct: `layout_version` = which format the corpus follows (corpus-level); `last_verified` = how fresh one document's content is (per-doc).

Task 0 has landed (PR #46): prompts are assembled from `prompts/partials/` via `{include:...}`, and there are fixture tests over rendered prompts in `tests/prompts.test.ts`. Both halves of this task (code + prompt edits) are therefore unblocked.

## Current state (verified)

- No `src/docs/` directory exists; nothing parses doc frontmatter today. `src/scripts/parse-plan.ts` parses *plan* frontmatter with the `yaml` package (already a dependency) — reuse its approach, not its code.
- Built-in scripts live in `src/scripts/<name>.ts`, registered in `src/scripts/registry.ts` (`defaultScriptRegistry`); handler signature `(args: Record<string,string>, ctx: ScriptContext) => Promise<unknown>`. Follow `saaga-docs/patterns/adding-built-in-scripts.md` exactly.
- Four flows: `flows/init.flow.yaml`, `update.flow.yaml`, `quick-update.flow.yaml`, `verify-quick-updates.flow.yaml`. Script steps take `label:` and args interpolated from scope; `${app_path}` and `${docs_dir}` are in scope in all four (see the `generate-baseline` steps for the arg pattern).
- Doc templates live in `prompts/partials/{concept,pattern,feature}-template.md`, aggregated by `partials/document-templates.md`; INDEX format in `partials/index-format.md`. `prompts/verify-domain-documentation.md` and `prompts/quick-update.md` are standalone prompt files.
- Tests: `tests/scripts/*.test.ts` (unit, per script), `tests/prompts.test.ts` (fixture tests on rendered prompts), `tests/cli/{init,update,quick-update,verify-quick-updates}.test.ts` (full flows through `runCli` with `FakeAgent`).

## Deliverables

### 1. Frontmatter module — `src/docs/frontmatter.ts`

New module (new `src/docs/` directory). No flow consumes it yet — it is foundation for task 7 and for tests. Export:

- `interface DocFrontmatter { title: string; type: "concept" | "pattern" | "feature" | "architecture" | "index"; last_verified?: string; sources?: string[] }` — `last_verified` is an ISO date (`YYYY-MM-DD`), `sources` a list of repo-relative source paths/globs.
- `parseDoc(content: string)` → `{ frontmatter: DocFrontmatter | null; body: string; errors: FrontmatterError[] }`. A doc without a leading `---` block returns `frontmatter: null`, `body` = whole content, no errors — **tolerance for pre-beta docs is required** (migration path). Malformed YAML or invalid fields (unknown `type`, non-string `title`, bad date, non-array `sources`) produce structured `FrontmatterError { field?, message }` entries — never a thrown exception.
- `serializeDoc(frontmatter: DocFrontmatter, body: string)` → string. `serializeDoc(parseDoc(x).frontmatter!, parseDoc(x).body)` must round-trip every valid fixture.

Use the `yaml` package for parse and stringify. Field names are fixed as listed (OKF v0.1 alignment) — do not rename them.

### 2. Layout version + gate script

**Version module** — `src/docs/layout-version.ts`:

- `CURRENT_LAYOUT_VERSION = 1`.
- `LAYOUT_FILE = "LAYOUT"` — the file lives at `<docs_dir>/LAYOUT` (all-caps, sibling of `BASELINE`, so it travels with the corpus; deliberately *not* in `.saaga/config.yaml`). Content is YAML: `layout_version: 1`.
- `readLayoutVersion(docsPath)` → `{ state: "no-corpus" } | { state: "corpus"; version: number }`. Rules: docs dir absent **or empty** → `no-corpus` (greenfield — never version 0); docs dir with any entries but no `LAYOUT` file → `corpus, version 0` (every pre-beta corpus is identifiable retroactively); `LAYOUT` present → its `layout_version` value (malformed file → descriptive error).
- `writeLayoutVersion(docsPath)` — writes the file with `CURRENT_LAYOUT_VERSION`, creating the docs dir if needed.

**Gate script** — `src/scripts/check-layout-version.ts`, registered as `"check-layout-version"`. Args: `app_dir`, `docs_dir`, `mode` (`"init"` or `"update"`). Resolves exactly three states (per the PR #42 amendment — do not regress to the two-state version):

1. **No corpus** → pass (both modes). Greenfield `init` must work; this is also the gate's own recommended upgrade path.
2. **Corpus at a mismatched version**, `mode: update` (a missing `LAYOUT` in an existing corpus reads as version 0) → throw with a message naming the found and expected versions and the upgrade path: delete `<docs_dir>` and run `saaga init` (mention that `saaga migrate` will handle this once it exists). Matching version → pass.
3. **Any existing corpus**, `mode: init` (any version, matching included) → throw with a delete-first message: re-init is an explicit two-step, never a silent overwrite.

Error messages start with the `check-layout-version:` prefix (script convention).

**Stamp script** — `src/scripts/stamp-layout-version.ts`, registered as `"stamp-layout-version"`, args `app_dir` + `docs_dir`, calls `writeLayoutVersion`. Void return.

This is the entire versioning machinery. No up/down migration framework, no `saaga migrate` — one known transition exists and the gate's error message covers it.

### 3. Flow wiring

- All four flows: add the `check-layout-version` script step as the **first** step (before `ensure-gitignore` in init, before `detect-changes` in update/quick-update, before `collect-quick-updates` in verify-quick-updates). `mode: init` in `init.flow.yaml`; `mode: update` in the other three. Give each a `label:` (e.g. `checking corpus layout version`).
- `init.flow.yaml` only: add the `stamp-layout-version` step as the **last** step (after `generate-baseline`). Update-family flows do not stamp: their gate already proved the file exists and matches, so a stamp there is a no-op by construction.

### 4. Prompt edits (task 0's partials)

- New partial `prompts/partials/frontmatter.md`: the schema (four fields, the five `type` values, ISO date format), an example block, and the rules — `sources` lists the source paths/globs the doc's claims cover; `type` matches the doc's kind (directory for concept/pattern/feature, `index` for INDEX files, `architecture` for ARCHITECTURE.md). Include it from `partials/document-templates.md` so the writer, fixer, verifier, and planners all see it verbatim.
- Add the frontmatter block to the top of the fenced template in each of `partials/concept-template.md`, `partials/pattern-template.md`, `partials/feature-template.md`, and `partials/index-format.md` — verify compares structure against these fences, so a doc with frontmatter must match the template that mandates it.
- `prompts/document-architecture.md`: instruct emitting frontmatter with `type: architecture`.
- `prompts/verify-domain-documentation.md`: new instruction — when the slice result is PASS, set `last_verified` in each reviewed doc's frontmatter to today's date (agent gets the date from `date +%F`). This is the one exception to "do not modify documents during review"; say so explicitly next to that existing rule. On FAIL, touch nothing.
- `prompts/quick-update.md`: instruct preserving existing frontmatter verbatim when editing a doc — in particular never bump `last_verified` (quick-updates are unverified by definition); emit the standard frontmatter block (without `last_verified`) when creating a new doc. This prompt has no includes, so state the schema inline briefly or add the include — prefer `{include:partials/frontmatter.md}` for a single source of truth.

### 5. Tests

- `tests/docs/frontmatter.test.ts`: round-trip on fixtures for every doc type; doc without frontmatter → `null` + unchanged body; malformed YAML / bad field values → structured errors, no throw.
- `tests/docs/layout-version.test.ts`: absent dir, existing-but-empty dir, dir with docs but no LAYOUT (→ version 0), valid LAYOUT, malformed LAYOUT; write-then-read.
- `tests/scripts/check-layout-version.test.ts`: one test per gate state — greenfield passes in both modes; version-0 corpus fails `mode: update` with the upgrade-path message; matching version passes `mode: update`; `mode: init` over an existing corpus (both version 0 and current) fails with the delete-first message. Plus `tests/scripts/stamp-layout-version.test.ts`.
- Flow coverage: assert every `flows/*.flow.yaml` starts with the `check-layout-version` step and that init ends with `stamp-layout-version` (load them via `loadFlow` in a test, e.g. extend `tests/engine/loader.test.ts` or a small new `tests/flows.test.ts`); extend the fake-agent CLI tests so at least one shows init stamping `LAYOUT` on a green run and one shows update failing fast on a version-0 corpus.
- `tests/prompts.test.ts` fixture assertions: rendered `slice-doc` contains the frontmatter instruction; rendered `verify-domain-documentation` contains the `last_verified`-on-PASS instruction; rendered `quick-update` contains the preserve instruction. Assert on distinctive phrases, not full text.

## Traps — read before coding

- **Existing CLI flow tests will break.** `tests/cli/update.test.ts`, `quick-update.test.ts`, and `verify-quick-updates.test.ts` build docs-dir fixtures with content but no `LAYOUT` file; once the gate lands they read as version 0 and fail fast. Update their setup helpers to stamp `LAYOUT` (call `writeLayoutVersion` or write the file directly). `tests/cli/init.test.ts` fixtures must *not* pre-create a non-empty docs dir except in the new init-over-existing-corpus failure test.
- **Do NOT add a `LAYOUT` file to this repo's own `saaga-docs/`.** After this merges, the nightly quick-update / weekly verify workflows fail fast on our version-0 corpus. That is the intended automation pause from the execution addendum ("pause the doc workflows from the first format-changing merge" — task 0 already merged, so the hazard is live). The corpus gets its `LAYOUT` at the regeneration milestone. Expect red nightly doc runs; PR CI is unaffected.
- **Do not hand-edit `saaga-docs/` documentation content** (per CLAUDE.md, docs updates are Saaga's job) — the README is the only doc you touch.
- Script arg values arrive as **strings** from YAML interpolation; validate them at the top of each handler with the script-name prefix in error messages.

## Out of scope

- Consuming `sources` for staleness selection — task 7.
- `saaga migrate` — post-milestone, once the beta format freezes.
- Any code path that parses doc frontmatter during flow runs — the module exists, prompts produce the data, nothing reads it yet.

## Chores / Definition of Done

- [ ] All deliverables above implemented; tests listed above written and green (`pnpm test` — full suite).
- [ ] `pnpm lint` clean.
- [ ] README updated: the frontmatter fields and what they mean, the `LAYOUT` file / corpus layout version, the gate's three states and its error messages (including the delete-then-`saaga init` upgrade path).
- [ ] Manual acceptance (needs a real agent run, can be a follow-up on the PR): one sample regenerated doc carries valid frontmatter with plausible `sources`.
