# Eval seed material

Distilled from *Saaga self-documentation: quality analysis* (Aug 18, 2026; `saaga-docs/` @
`e87ffb9`, 16 of 46 documents sampled, rubric written before reading the docs). Purpose: give
task 9 (paired eval harness) and the regeneration milestone the factual material they need
**without** the full analysis — which argues for the refactor and would bias a planner toward
success checks that flatter the new corpus. Each section is labeled with which half of the task
set may use it.

## Methodology rules for task 9

- **Two-halves task design.** *Defect-targeted* tasks (regression probes derived from this file)
  and *neutral* tasks (drawn from real recent work — merged PRs, completed board cards — chosen
  blind to this file). Report the halves separately: the defect half measures fix-verification;
  only the neutral half supports the headline "does the corpus help an agent" claim.
- **Pre-registered, condition-blind checks.** Author every per-task success check before running
  any condition. (The analysis wrote its rubric before reading the docs; copy that discipline.)
- **Condition isolation.** The "no docs" condition must remove not just `saaga-docs/` but also
  the AGENTS.md managed rule block and any `.saagarules` routing that points agents at the docs —
  otherwise the condition leaks.
- **Prior art.** OpenWiki ships a DeepSWE-based eval harness; study it before designing the
  runner. It also defines the reference point for the optional third (OpenWiki-wiki) condition.
- **Repetition.** Run each condition at least twice and report the spread, not point estimates.

## Depth-preservation probes *(neutral half — fair to both corpora)*

The analysis judged this content "right depth": agents need it, and the old corpus provably has
it. If the new corpus loses it to budgets or trimming, these tasks catch the over-trim — the
refactor's biggest unmeasured risk. This is the probe set that can show the refactor made things
*worse*.

| Content | Old-corpus home | Task shape |
|---|---|---|
| Change classification taxonomy (`changed` / `new` / `truly_deleted` / `newly_ignored`) with its condition table | `concepts/baseline-and-change-detection.md` | Predict how a given file state is classified in `changes.md` |
| "Deepest match wins" `.saagaignore` layering; symlinks hashed from the link-target string, never traversed | `concepts/baseline-and-change-detection.md` | Write a `.saagaignore` that excludes X but keeps Y; explain what a symlink contributes to BASELINE |
| Denial classification: full 6-step priority order and what each `DenialClass` means for the user | `concepts/agent-events.md` | "A denial was classified `unexpected` — what does that mean and which flag fixes it?" |
| `awaitProcess()` concurrent stdout draining, explained via the pipe-buffer deadlock it prevents | `patterns/adding-agent-backends.md` | Implement a new backend; check the deadlock is avoided/explained |
| Why a bare Bash deny is used only for `shell=none`, and why Cursor needs deny-list enumeration | `concepts/agent-permissions.md` | Permission-profile reasoning task |

## Verified-true anchor facts *(neutral half)*

Spot-verified correct against source during the analysis (~20 claims checked; these passed).
Tasks built on them are fair to both corpora; if the new corpus drops them in dedup or trimming,
the eval catches it.

- Model-tier defaults
- The full doctor probe catalogue (all 20 probes)
- `ALLOWED_BACKENDS`
- Capability-retry classification
- The fast-tier skip of `unknown-model-fails`

## The four confirmed stale claims *(defect half only — also the milestone's checklist)*

All trace to one event: PR #17 renamed the shell policy `read-only-git` → `none | restricted`
(PR #20 later enabled Claude restricted shell). Docs written before the rename were never swept.

| # | Document | Stale claim | What the source says | Severity |
|---|---|---|---|---|
| 1 | `features/agent-invocation.md` | Shell policy table: Cursor `read-only-git`, Copilot `none`, Claude `none` | `AgentPermissions.shell` is `"none" \| "restricted"`; all three backends honor `restricted` | Major |
| 2 | `features/agent-invocation.md` | Restricted-mode mechanism for Copilot includes `--allow-all-tools` | `--allow-all-tools` is the unrestricted-mode flag; restricted mode uses `--available-tools` + `--allow-tool` | Major |
| 3 | `features/agent-invocation.md` | Backend fallback reads the config `backend` field | The field is `defaultBackend` (`SaagaConfig`, `src/cli/config.ts`) | Minor |
| 4 | `patterns/testing-with-fake-agent.md` | Example asserts `permissions?.shell === "read-only-git"` | Never type-checks; the type is `"none" \| "restricted"` since the rename | Major |

Survival timeline (why slice-scoped verification missed them): written accurately at PR #16 →
renamed in PR #17 → a quick-update (PR #33, Aug 16) edited `agent-invocation.md` itself and the
stale table survived → a verify-quick-updates pass (`e87ffb9`, Aug 17) hardened the file again
and it survived again.

**Milestone check:** none of these four claims may appear anywhere in the regenerated corpus.

## Trim-verification probes *(defect half)*

Judged "over-documented"; the regenerated corpus should not contain them at depth:

- Braille spinner glyph sequence, 120 ms frame interval, `\r\x1b[K` clear escape, marker column
  positions (`concepts/output-and-progress.md`)
- The literal `PROMPT = 'Continue? [y/N] '` constant and the EOF-race mechanism
  (`concepts/cost-confirmation.md` — the observable contract *EOF → decline, y/yes → proceed*
  belongs; the constant and the racing internals do not)
- The `emptyCounts()` helper roster entry (`concepts/agent-events.md`)
- The `.gitignore` backup's 8-hex suffix detail (ARCHITECTURE — the rename side effect is
  doc-worthy; the suffix length is parameter trivia)

## Term-collision probes *(defect half — retrieval confusion)*

Ask a question using the ambiguous term; check the agent lands on the right document.

- `phase`: plan slice vs the terminal "Phase N/M" progress line
- `slice` vs `phase` (AGENTS.md said "slice workflow")
- `scope`: runtime scope dictionary vs `.saagaignore` documentation scope
- `backend` vs `agent`

## Baseline numbers *(for the milestone's before/after comparison)*

Two countings exist; re-measure at the `pre-beta-corpus` tag and record which definition is used:

- Analysis @ `e87ffb9`: **46 documents** (ARCHITECTURE + 18 concepts + 13 features + 11 patterns
  + 3 indexes), **~5,600 doc lines**. OpenWiki graph: 39 nodes, 123 edges, 0 broken links,
  ARCHITECTURE a link orphan.
- Plan milestone figure: **39 files / ~32k words**.

Level-of-detail baselines:

- Whole repo: 0.83 doc lines per source line (5,589 / 6,751)
- `cost-confirmation` 0.69 vs `baseline-and-change-detection` 0.26 doc-lines/src-line
- Churn ratios: 0.42–0.46 (major features) vs 0.89–3.30 (small changes)
- One verify pass added **+747 doc lines with zero code change** (Aug 17) — optional secondary
  metric for the eval report: doc growth per maintenance pass, old vs new pipeline
