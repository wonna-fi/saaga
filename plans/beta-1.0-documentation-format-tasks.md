# Beta 1.0 documentation-format tasks

Derived from the documentation quality analysis (rubric evaluation, LOD/churn measurements,
and the Saaga-vs-OpenWiki comparison). Ten tasks in five tracks. Each task is written to be
self-contained: it can be picked up without reading the full analysis.

**Sequencing**

- Task 0 comes first: it moves the methodology's home from generated plans into prompts, and
  tasks 1 and 4–6 write their rules into that home. Doing them in the other order means writing
  rules into plan prompts and then migrating them.
- After task 0: tracks A (tasks 1–3) and B (tasks 4–6) are independent of each other and internally
  parallelizable, except task 3 which should land after task 2 so the orphan check validates its
  output.
- Task 7 depends on task 1. Task 8 depends on tasks 4 and 6.
- Task 9 is fully independent — start it early, because it turns the verification of tasks 4–6
  from rubric judgment into measurement.
- Regenerate the corpus **once**, after tasks 0–6 have landed (see Milestone), not per task.

**Verification model**

- Script tasks (1, 2, 3, 7 partially, 9): normal Definition of Done — unit tests, suite green, README.
- Prompt tasks (4, 5, 6): automated part is fixture tests asserting the rendered prompt contains the
  new rules (via the existing `templates.ts` rendering path); the substantive part is a **sample
  regeneration** of named docs, checked against the acceptance criteria below.

---

## Track 0 — Pipeline refactor

### Task 0: Plans carry decisions, prompts carry methodology

**Motivation.** Historically Saaga was run by invoking agents manually, so the generated plan had
to carry everything and `prompts/slice-doc.md` shrank to 23 lines of "read the plan". The flow
engine removed that constraint, but the shape survived. Measured on a real run
(`saaga-update-20260728`): the generated plan is 592 lines, of which ~420 (sections 3–9: document
templates, decision guidance, quality checklists, uncertainty handling, verification protocol) are
static methodology the model re-transcribed from `plan-update.md`. The actual decisions are ~170
lines. Consequences: the invariants reach the doc writer through two lossy model hops (a plausible
contributor to the measured LOD inconsistency), the static content is paid for in output tokens on
every run, and the reviewable decisions are buried in boilerplate — the plan is the artifact a
client architect is supposed to review.

**Scope.**

1. **Include mechanism.** Extend `src/templates.ts` with an include directive (e.g.
   `{include:partials/concept-template.md}`, resolved at render time relative to `prompts/`,
   recursion-safe). Today the renderer is plain `{key}` substitution.
2. **Extract partials.** Move the static methodology out of `prompts/plan-init.md` and
   `prompts/plan-update.md` into `prompts/partials/`: the three document templates, decision
   guidance, quality checklists, uncertainty handling, and the verification protocol.
3. **Re-home the methodology.** `prompts/slice-doc.md` includes the templates, decision guidance,
   and uncertainty partials directly; `prompts/verify-domain-documentation.md` and
   `prompts/fix-documentation.md` include the checklists and verification protocol. The plan
   prompts keep the templates as *reference context* for slicing decisions but no longer instruct
   the plan to re-emit them.
4. **Slim plan format.** The plan carries only decisions: change summary, approach, phase
   breakdown with docs to create/update and key files to analyze, per-doc notes, execution
   strategy, success criteria — plus a **template adaptations** section for repo-specific deltas
   only (e.g. "rename User Flow → Execution Flow for engine features"), never full templates.
   In practice adaptation has been near-verbatim re-emission (generated plans match the universal
   templates, and every sampled doc followed them exactly), so deltas lose nothing.
5. **Preserve auditability.** The archived plan currently records everything the writer saw; after
   the split it won't. Copy each rendered prompt into the run directory alongside the plan so a run
   remains fully reconstructible.
6. Update `src/scripts/parse-plan.ts` if the frontmatter/format changes (phases array stays).

**Out of scope.** Any change to *what* the methodology says (that's tasks 4–6); this task only
moves its home.

**Acceptance criteria.**

- [ ] Include mechanism unit-tested in `tests/templates.test.ts` (nested include, missing partial
      error, no infinite recursion).
- [ ] Rendered `slice-doc` prompt contains the three document templates verbatim (fixture test);
      rendered plan prompts no longer instruct re-emitting them.
- [ ] Sample regeneration: the generated plan contains no template/checklist sections and lands
      well under half its current length; the docs produced still pass verify.
- [ ] Run directory contains the rendered prompts for every agent step.
- [ ] `parse-plan` tests updated and green; fake-agent flow tests green.

---

## Track A — Deterministic infrastructure (code)

### Task 1: Frontmatter and layout-version foundation *(prompt edits depend on task 0)*

**Motivation.** Staleness is the one proven failure mode (4 confirmed stale claims survived multiple
update passes). Docs need machine-readable metadata: when a doc was last verified and which source
files it covers. Making the fields OKF-compatible is free interop — OpenWiki's visualizer already
renders `saaga-docs/` (verified: 39 nodes, 123 edges) but collapses all nodes to one untyped color
without frontmatter. The corpus additionally needs a **layout version**: the verify loop compares
document structure against the templates, so running an upgraded Saaga (new templates) against a
pre-beta corpus would structurally fail every touched doc and send the fix loop on an unplanned,
token-burning rewrite. A version gate turns that into a clear error instead.

**Scope.**

- Define the frontmatter schema: `title`, `type` (`concept` | `pattern` | `feature` | `architecture` |
  `index`), `last_verified` (ISO date), `sources` (list of covered source paths/globs). Field names
  aligned with OKF v0.1 where they overlap.
- New module `src/docs/frontmatter.ts`: parse + serialize + validate; tolerant of docs without
  frontmatter (migration path).
- Prompt edits: the document template partials (`prompts/partials/`, from task 0) instruct emitting
  frontmatter; `prompts/verify-domain-documentation.md` instructs updating `last_verified` on PASS;
  `prompts/quick-update.md` instructs preserving it.
- **Corpus layout version.** A small metadata file inside `saaga-docs/` (it must travel with the
  corpus, so not `.saaga/config.yaml`) carrying `layout_version: 1`, written by init/update. In an
  existing corpus, a missing file means version 0 (pre-beta) — every existing corpus is
  identifiable retroactively. An absent or empty docs directory is not a corpus at all
  (greenfield), never version 0. Corpus-level, not per-doc: migrations act on the whole tree, and
  per-doc stamps invite mixed-version states.
- **Version gate.** A built-in script, run as the first step of every flow, resolving three
  states: (1) *no corpus* — docs directory absent or empty — passes; `init` proceeds and stamps
  `layout_version` on the tree it creates. (2) *Corpus present at a mismatched version* (a missing
  file in an existing corpus reads as version 0) — the update-family flows (`update`,
  `quick-update`, `verify-quick-updates`) fail fast with a message naming the upgrade path.
  (3) *`init` over an existing corpus* (any version) — fails with a message instructing to delete
  the old corpus first (or, once it exists, run `saaga migrate`), making re-init an explicit
  two-step rather than a silent overwrite. Explicitly a gate, not a migration framework — one
  known transition exists; numbered up/down migration machinery is premature.
- Distinct axes, kept distinct: `layout_version` says which format the corpus follows;
  `last_verified` says how fresh a document's content is.

**Out of scope.** Consuming `sources` for staleness selection (task 7). The `saaga migrate` command
(see Milestone) — it only becomes real work once the beta format is frozen.

**Acceptance criteria.**

- [ ] Parser round-trips every fixture; invalid frontmatter produces a structured error, not a throw.
- [ ] The rendered `slice-doc` prompt contains the frontmatter instruction (fixture test).
- [ ] A sample regenerated doc carries valid frontmatter with plausible `sources`.
- [ ] Docs without frontmatter still pass through all flows unchanged.
- [ ] Version-gate unit tests, one per state: greenfield (absent or empty docs dir) passes and
      `init` stamps the version; an existing corpus without the file reads as version 0 and fails
      the update-family flows with the upgrade-path message; `init` over an existing corpus fails
      with the delete-first message; matching version passes; all flows contain the gate step.

---

### Task 2: Deterministic structural post-processor

**Motivation.** Link integrity is currently enforced only semantically by the verify agent — a
model-dependent guarantee costing ~3 agent sessions per slice. The OpenWiki probe found 0 broken
links (the loop works) but that is luck plus tokens; structural checks belong in code. This also
frees the verify prompt to focus on the semantic rot it alone can catch.

**Scope.**

- New built-in script `validate-docs` registered in `src/scripts/registry.ts`:
  - resolve every relative Markdown link in `saaga-docs/`; report unresolved targets;
  - parse every ` ```mermaid ` fence; report invalid diagrams;
  - detect orphan documents (no inbound links from any INDEX/README);
  - write a machine-readable report into the run directory.
- Wire as a `script` step at the end of `flows/init.flow.yaml`, `flows/update.flow.yaml`, and
  `flows/quick-update.flow.yaml`. Failure behavior: broken links/diagrams fail the flow with the
  report path in the error; orphans are warnings.
- Optional (nice to have): OpenWiki-style degrade-in-place — downgrade an invalid Mermaid fence to a
  `text` fence with an explanatory comment that a later run can repair.

**Decision to make during implementation.** Mermaid validation dependency: prefer a parse-only check
with a small footprint over pulling in full mermaid rendering; document the choice in the README.

**Acceptance criteria.**

- [ ] Unit tests in `tests/scripts/validate-docs.test.ts` cover: broken link, valid/invalid Mermaid,
      orphan, clean tree.
- [ ] All three flows contain the step; fake-agent flow tests still pass.
- [ ] Run against the current `saaga-docs/` reproduces the known finding: `ARCHITECTURE.md` reported
      as an orphan, 0 broken links.

---

### Task 3: Generated navigation layer (glossary + entry point + de-orphan ARCHITECTURE)

**Motivation.** The corpus fails the "newcomer path" criterion: no entry point, ARCHITECTURE.md is a
verified graph orphan, and terms collide (`phase` vs `slice`, two meanings of `scope`). All of this
is derivable from existing content — it must be generated, not agent-authored, so it costs no tokens
and cannot rot independently.

**Scope.**

- New built-in script `generate-navigation`:
  - `saaga-docs/README.md`: reading order (ARCHITECTURE → 3–4 core concepts → workflows) with links
    to the three INDEX files;
  - `saaga-docs/GLOSSARY.md`: term, one-line definition **copied** from the owning INDEX entry
    (never authored fresh — no second home for any fact), aliases, link; flag colliding terms with
    "see also" lines;
  - ensure ARCHITECTURE.md is linked from the README (kills the orphan).
- Wire after `validate-docs` in the same flows. Must be idempotent.

**Out of scope.** Any agent-written glossary prose. If a definition can't be extracted from an INDEX,
the term is omitted, not invented.

**Acceptance criteria.**

- [ ] Unit tests with fixture INDEXes; second run on unchanged input produces zero diff.
- [ ] Task 2's orphan check passes on the generated output.
- [ ] Glossary contains the known colliding terms with see-also entries.

---

## Track B — Prompt policy (LOD, taxonomy, dedup)

### Task 4: LOD policy — budgets, consequence test, diff budget, amortization *(depends on task 0)*

**Motivation.** Measured problems: `cost-confirmation.md` spends 0.69 doc-lines per src-line while
`baseline-and-change-detection.md` (far more important) gets 0.26; small commits generate 0.9–3.3
docs/src ratios versus 0.4–0.5 for large features (the LOD ratchet); templates reward transcription
(braille spinner glyphs, `emptyCounts()` documented). Every pipeline force pushes detail up; nothing
pushes it down.

**Scope.** *(Post task 0, the rules split by nature.)* Static rules (2, 4, 5) go into the shared
partials under `prompts/partials/` — reaching the writer and verifier verbatim; dynamic rules (1, 3)
go into the planning prompts `prompts/plan-init.md`, `prompts/plan-update.md`, and
`prompts/quick-update.md`, because they produce per-run decisions recorded in the plan.

1. **Importance-weighted length budgets.** The plan assigns each document a line budget derived from
   the covered source's size and centrality (how many other modules depend on it), replacing the
   implicit uniform 50–150 line band. The budget is recorded in the plan and enforced by verify.
2. **Consequence test for algorithms.** Document an internal mechanism in full only if it is
   (a) externally observable, (b) a constraint on other/future code, or (c) a recorded decision.
   Otherwise: name it in one line with its rationale. Include the canonical positive example
   (denial classification — its output is the user interface) and negative example (spinner glyph
   sequence — cosmetics with zero dependents).
3. **Churn-proportional diff budget.** In `plan-update` and `quick-update`: if fewer than ~5 source
   files changed, update at most 1–2 documents; never create a new document for a change unless it
   introduces a genuinely new concept.
4. **Amortization rule.** Small changes fold into existing docs (a row in an existing table, a
   sentence in an existing section) rather than growing new sections.
5. **Remove the transcription rewards.** Drop or soften checklist items that score completeness of
   internal helpers; the "Internal Implementation" section becomes subject to the consequence test.

**Acceptance criteria.**

- [ ] Fixture tests: the rendered planning prompts contain the budget and diff-budget rules; the
      rendered `slice-doc` and verify prompts contain the consequence test (assert on distinctive
      phrases, not full text).
- [ ] Sample regeneration of `concepts/cost-confirmation.md` and `concepts/output-and-progress.md`
      produces docs that pass verify **and** are materially shorter (spinner glyph/frame-interval
      detail and the `PROMPT` constant no longer transcribed).
- [ ] Sample regeneration of `concepts/baseline-and-change-detection.md` does not shrink (the
      budget protects important docs, not just trims).

---

### Task 5: Taxonomy — template relaxation, conventions category, hard conventions/patterns line *(depends on task 0)*

**Motivation.** Infrastructure concepts are forced into Business Definition / Configuration / Data
Storage sections that don't apply (scope-and-expressions lists flow steps under "Configuration");
engine mechanics get described as a "User Flow". Lexical rules currently hide inside pattern how-tos
with no home of their own.

**Scope.** The template and checklist partials under `prompts/partials/` (from task 0), plus the
planning prompts where slicing guidance mentions doc types.

1. **Optional sections.** Concepts may omit Configuration / Data Storage when inapplicable; verify
   must not fail a doc for a justified omission.
2. **Mechanism section.** Internal-machinery features may use "Mechanism" instead of "User Flow".
3. **Conventions category.** New `saaga-docs/conventions/` with a hard-capped template (5–20 lines
   per file: the rule, one conforming example, one counter-example, where it applies). One file per
   convention *family* (e.g. naming, file layout, error messages), never per individual rule.
4. **The hard line**, stated in both templates and both INDEX descriptions: *patterns* describe how
   to implement something (steps, code structure); *conventions* describe what things must be named
   or shaped like (lexical/structural rules). A rule that requires reading code flow is a pattern;
   a rule checkable by grep is a convention.
5. `src/scripts/install-rules.ts` AGENTS.md block mentions the conventions category in its routing
   table.

**Acceptance criteria.**

- [ ] Fixture tests on rendered prompts (optional-section language, conventions template, hard line).
- [ ] Conventions template in the prompt is itself ≤ 20 lines.
- [ ] Sample regeneration: `concepts/scope-and-expressions.md` no longer lists scope-mutating flow
      steps under "Configuration"; at least one conventions file is produced and passes verify.
- [ ] README documents the new category.

---

### Task 6: Single home per fact — dedup policy and planning step *(depends on task 0)*

**Motivation.** Flow step sequences are restated in four places; `cli-entry-point.md` re-documents
ARCHITECTURE's CLI section including 15+ non-exported helpers. Duplication is where the confirmed
staleness lives — every fact with N homes needs N updates and got fewer.

**Scope.** Edits to `prompts/plan-init.md`, `prompts/plan-update.md`,
`prompts/document-architecture.md`, and the decision-guidance partial (from task 0) so the writer
sees the ownership rules verbatim, not via plan paraphrase.

1. **Ownership rules.** Each fact class gets one owning doc type, stated in the decision-guidance
   partial: flow step sequences → the workflow feature doc; CLI surface → ARCHITECTURE (summary)
   with details in feature docs; everything else cross-references with a link instead of restating.
2. **ARCHITECTURE diet.** `document-architecture.md` instructs linking to concept/feature docs
   rather than inlining their content, and gets an explicit length budget (task 4's mechanism).
3. **Dedup planning step.** The plan format gains a per-document "owns / references" declaration:
   for each planned doc, which facts it owns and which docs it links to for the rest. Verify checks
   that a doc does not restate content it declared as referenced.
4. **ARCHITECTURE under verification.** The init flow gains a verify/fix pass over the generated
   `ARCHITECTURE.md` — a dedicated verify step after the architecture step, or folded into phase
   0's verification (implementer's choice, justified in the PR). Rationale: the init flow
   generates ARCHITECTURE before the plan exists and outside the per-phase verify/fix loop, so it
   is the only document nothing verifies at generation time — and the analysis's core finding on
   this doc is that it ignored its own prompt's rules ("concise", "public interface only", all
   violated by the 687-line output). The diet and budget above cannot be enforced by the writer
   prompt alone; until task 7's sweep runs post-milestone, this pass is the only enforcement.

**Acceptance criteria.**

- [ ] Fixture tests on rendered prompts (ownership rules, owns/references plan fields).
- [ ] `src/scripts/parse-plan.ts` accepts the extended plan format (with tests) — or, if the format
      is prose-only, the task documents why no parser change is needed.
- [ ] Sample regeneration: each workflow's step sequence appears in exactly one document;
      `features/cli-entry-point.md` no longer duplicates ARCHITECTURE's CLI walkthrough.
- [ ] Fake-agent init flow test covers the ARCHITECTURE verify/fix pass; sample regeneration: the
      regenerated `ARCHITECTURE.md` passes verify against its length budget and its
      links-instead-of-inlines rule.

---

## Track C — New flow capabilities

### Task 7: Repo-wide staleness sweep *(depends on task 1)*

**Motivation.** Verification only checks the current slice. The `read-only-git` → `restricted`
rename invalidated claims in two docs outside every subsequent slice; one stale table survived both
a quick-update and a verify pass because they looked elsewhere. ARCHITECTURE.md is in no verify
rotation at all.

**Scope.**

- New built-in script `select-stale-docs`: using each doc's `sources` frontmatter (task 1) and the
  BASELINE manifest diff, emit the list of docs whose covered sources changed since their
  `last_verified` date — regardless of slice membership. ARCHITECTURE.md is always eligible.
- Extend `flows/verify-quick-updates.flow.yaml` (or add a dedicated sweep flow — implementer's
  choice, justified in the PR): feed the selected docs through the existing verify/fix loop.
- `prompts/plan-verify-quick-updates.md` updated to consume the selection instead of (or in addition
  to) its current scope.

**Acceptance criteria.**

- [ ] Unit tests for `select-stale-docs`: changed source → doc selected; untouched doc not selected;
      doc without frontmatter → conservative default (selected), with a test proving it.
- [ ] Regression scenario test: simulate the `READ_ONLY_GIT` rename (a source change covered by two
      docs outside the active slice) and assert both docs are selected.
- [ ] Fake-agent flow test for the extended flow; verify loop updates `last_verified` on PASS.

---

### Task 8: docs-gc — the downward force *(depends on tasks 4 and 6)*

**Motivation.** Every pipeline mechanism adds detail; nothing removes it. LOD drift is measured
(0.9–3.3 docs/src on small changes) and will continue even after task 4, because task 4 only governs
*new* writing. Existing accumulation needs a periodic collector.

**Scope.**

- New `flows/docs-gc.flow.yaml` + `prompts/docs-gc.md`: mandate to merge near-twin documents, trim
  transcription-level detail per the consequence test (task 4), delete sections that restate an
  owning doc (task 6's ownership rules), and enforce length budgets. Every gc'd slice goes through
  the existing verify/fix loop. A deletion report (what was removed and why) is written to the run
  directory.
- CLI wiring in `src/cli.ts` (`saaga docs-gc`), behind the unstable-features gate initially.
- Guardrail: docs-gc may merge and trim but must not delete a document unless its full content is
  demonstrably owned elsewhere; the prompt states this and the deletion report proves it.

**Acceptance criteria.**

- [ ] Fake-agent flow test covering the gc → verify → fix loop.
- [ ] Real run on `saaga-docs/`: the `prompt-templates.md` / `templates-and-prompt-rendering.md`
      twins are merged, net corpus line count decreases, and all touched slices pass verify.
- [ ] Deletion report present and human-readable in the run directory.
- [ ] README documents the command and its cadence relative to `update` / `quick-update`.

---

## Track D — Measurement

### Task 9: Paired eval harness *(independent — start early)*

**Motivation.** Every LOD and format decision above is currently argued by rubric. The competing
tool ships a published eval; Saaga has none — it is both the most exposed flank externally and the
missing instrument internally. With a harness, tasks 4–6 get measured (agent task success with the
new corpus vs the old) instead of eyeballed.

**Scope.**

- New top-level `eval/` directory (not part of the shipped package):
  - a task set: 10–20 concrete agent tasks against one mid-sized repo (candidate: Saaga itself,
    acknowledging the self-reference bias in the README);
  - a runner that executes each task via an agent CLI in three conditions: no docs, with
    `saaga-docs/`, and (optionally) with an OpenWiki wiki;
  - scoring: task success (binary, per a per-task check script), tokens/turns consumed;
  - a report generator producing a markdown comparison.
- CI-runnable smoke path using `src/agent/fake-agent.ts` so the harness itself is tested without
  spending tokens.

**Out of scope.** Publishing results; multi-repo benchmarking; statistical rigor beyond honest
caveats. First iteration answers one question: does the corpus measurably help an agent on this repo?

**Acceptance criteria.**

- [ ] Harness end-to-end test with the fake agent passes in CI.
- [ ] One real paired run completed; report committed under `eval/reports/`.
- [ ] Method and caveats documented in `eval/README.md`.

---

## Milestone: corpus regeneration

After tasks 0–6 land: run `saaga init` on Saaga itself once to rebuild the corpus under the new
rules. This is the integration test for the whole prompt track. Success criteria: task 2's validator
passes, total corpus size decreases versus the current 39 files / ~32k words, spot-checked docs meet
their budgets, and the known stale claims are gone. Then run task 9's eval against old and new
corpora — the before/after comparison is the beta's headline evidence.

Once the beta format is frozen, add a `saaga migrate` command for existing (version-0) corpora,
with honest division of labor: structural steps run deterministically in code (frontmatter
skeletons, category moves, regenerating README/GLOSSARY/INDEXes — machinery tasks 2 and 3 already
build), while semantic upgrades (LOD trims, dedup merges, budget enforcement) are delegated to the
agent flows that own them (docs-gc or re-init). The `layout_version` gate from task 1 tells each
corpus which mix it needs; until migrate exists, the gate's error message recommends re-init —
delete the old corpus, then run `saaga init`, which the gate's greenfield state permits.

## Explicitly not included

- **"Suspicious" category** — parked per the cost–benefit analysis; the bottleneck is triage, not
  storage. Suspicions surface in run output / PR bodies instead.
- **Resumable runs and per-step timeouts** — a real beta gate but pipeline robustness, not
  documentation format; belongs in a separate operational track.
- **CI templates, visualizer, chat** — product packaging, out of scope for the format work.

---

## Execution addendum (sequencing amendments)

Added when the epic was broken into Trello cards. The task list above is the canonical scope;
this section refines *how* it is executed. Each Trello card carries its wave assignment.

### Wave plan

Several tasks split into a code half and a prompt half, which allows more parallelism than the
track summary suggests: task 2 is pure script + flow wiring and does not need task 0; task 1's
frontmatter module, layout-version file, and version gate are pure code — only its prompt edits
wait on task 0.

| Wave | Tasks | Notes |
|------|-------|-------|
| 0 (start now, parallel) | Task 0, Task 9, Task 2, Task 1 code half | Four independent lanes |
| 1 (after task 0) | Task 1 prompt half, Tasks 4–6, Task 3 (after 2) | See Track B note below |
| 2 | Task 7 (after 1), Task 8 (after 4+6) | Prefer landing after the regeneration milestone |
| Milestone | Regenerate corpus → paired eval → freeze format → `saaga migrate` | |

### Track B lands sequentially through one owner

Tasks 4, 5, and 6 all edit the same files — the partials created by task 0 and the two planning
prompts. Draft them in parallel if desired, but land them sequentially with a single owner doing
integration: prose merge conflicts are worse than code conflicts because the rules must read as
one coherent instruction set. Their sample-regeneration criteria target different documents, so
run **one combined sample regeneration after all three land** instead of three separate ones;
fall back to per-task samples only if a failure needs attribution.

### Capture the "before" state ahead of regeneration

- Run the task 9 eval against the **old** corpus before the milestone regeneration and commit the
  report under `eval/reports/` — after regeneration the old corpus exists only in git history.
  Tag the pre-regeneration commit (e.g. `pre-beta-corpus`) so the harness can check it out.
- Record the baseline numbers where the milestone can check them: 39 files / ~32k words, the LOD
  ratios (0.69 vs 0.26 doc-lines/src-line; 0.9–3.3 churn ratios), and the list of 4 confirmed
  stale claims. "The known stale claims are gone" is only verifiable if the list survives outside
  the analysis document.
- The eval delta is sensitive to LLM variance: if a full init cannot be run twice, run the eval
  itself at least twice per corpus condition and report the spread, not a point estimate.

### Regenerate before tasks 7 and 8

Task 7's `select-stale-docs` needs `sources` frontmatter, which the old corpus lacks — against a
version-0 corpus it degrades to "select everything". Task 8's real-run criterion (merging the
`prompt-templates.md` / `templates-and-prompt-rendering.md` twins) is written against the old
corpus; if the new dedup rules work, the regenerated corpus will not have those twins. Either run
task 8's real run against the old corpus checked out from the tag into a scratch directory, or
adjust that criterion after regeneration (net line count decreases + deletion report still hold).

### Pause the doc workflows from the first format-changing merge

The nightly quick-update and weekly verify workflows run **main's source** (`pnpm install` +
`npx tsx src/cli.ts run …`), not a published package. Every task merged to main is live in that
night's run — so the moment format-changing work lands (task 0, or the first of tasks 4–6), the
automation runs new prompts and templates against the old version-0 corpus. That is the
"upgraded Saaga vs pre-beta corpus" hazard from task 1, arriving mid-epic rather than at the
milestone; the weekly verify pass is the worst case, sending the fix loop after docs scheduled
for deletion.

Two equivalent mitigations — pick one:

- **Manual:** disable the two doc workflow schedules when the first format-changing task merges,
  and re-enable them in the regeneration PR.
- **Automatic:** land task 1's version gate early (it is wave 0 anyway) and bump the layout
  version Saaga *writes* alongside the first format-changing merge — the update-family flows then
  fail fast on the version-0 corpus with a clear error, pausing doc automation without a manual
  toggle. Note the nightly runs stay red until regeneration; treat that as expected.

The regeneration PR itself stays atomic: delete old `saaga-docs/`, commit new corpus + BASELINE +
layout-version file, tag the parent commit, re-enable the workflows. Publishing the beta to npm
is still a milestone step, but it protects external users — it plays no role in protecting this
repo's corpus, since the actions never consume the published package.

### During the epic

Tasks 0–6 make the current docs progressively wrong about the pipeline; nobody hand-fixes them
(per CLAUDE.md) and the regeneration wipes the drift. Skip `verify-quick-updates` runs in the last
stretch before the milestone — that is tokens spent hardening docs scheduled for deletion.

### Amendment: version-gate states (from PR #42 review)

Task 1's gate originally read a missing `layout_version` file as version 0 unconditionally, which
would have blocked greenfield `init` — and with it the gate's own recommended re-init upgrade
path. The task now distinguishes three states: no corpus passes (greenfield init), a mismatched
existing corpus fails the update-family flows with the upgrade-path message, and `init` over an
existing corpus fails with a delete-first message so re-init stays an explicit two-step.

### After task 0 lands: review the generated plan

The generated plan shrinks to ~170 lines of pure decisions, which makes human review of the
regeneration plan viable for the first time. Before the milestone init spends its tokens on
slicing, someone should read the plan it produced.
