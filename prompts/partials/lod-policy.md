## Level of Detail

### Length Budgets

Every document has a line budget. The plan assigns it; the bands below are what the
plan chooses from.

| Tier | Test | Band |
| --- | --- | --- |
| **Core** | On the main execution path, or three or more other documents link to it | 100–200 lines |
| **Supporting** | One or two other documents link to it | 60–120 lines |
| **Peripheral** | A leaf — nothing else depends on it | 25–60 lines |

Tier is **centrality, not source size**. A 600-line module of cosmetics is Peripheral;
a 150-line module every flow passes through is Core.

The plan records a tier and an exact number per document, for example
`cost-confirmation.md — Peripheral, 55 lines`. Write to the number, not to the band's
ceiling. The budget counts every line in the file, frontmatter included.

A document the plan assigned no budget has no budget. Do not invent one.
A convention document never gets one: its template caps it at 5–20 lines of
body, which is below this table's lowest band, and `validate-docs` fails the run
above the cap.

### The Consequence Test

Document an internal mechanism in full **only** if at least one of these holds:

(a) **Externally observable** — a user or a caller can see its output.
(b) **A constraint on other code** — code written later must respect it.
(c) **A recorded decision** — the choice was deliberate and someone will ask why.

Otherwise, name it in one line with its rationale and stop.

**Passes.** Denial classification in `src/agent/audit.ts`: its output *is* the
user-facing audit summary, so the classes are the interface. Document them.

**Fails.** The spinner's braille glyph sequence and its 120 ms frame interval:
cosmetics, no dependents, nothing breaks when they change. "The pending line animates
while a phase runs" is the whole of it.

Transcription is not documentation. A private constant's literal value, a list of
internal helper names, and prose restating a function body all fail the test unless
they clear (a), (b) or (c).

### Amortization

A small change folds into what already exists — a row in an existing table, a sentence
in an existing section. It does not earn a new section, and it does not earn a new
document. Create a new document only for a genuinely new concept, never merely because
a change felt significant.
