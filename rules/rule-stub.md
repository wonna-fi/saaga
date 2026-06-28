### Domain Documentation ({app})

This codebase has structured domain documentation under `docs/`, organized into three types:

| Type | Index | Answers |
|------|-------|---------|
| Concepts | `docs/concepts/INDEX.md` | What something is and where it lives |
| Patterns | `docs/patterns/INDEX.md` | How to do common operations |
| Features | `docs/features/INDEX.md` | How a feature works end-to-end |

Classify your question, open the matching `INDEX.md`, and read the relevant document(s):

- "What is X / where does X live?" -> read a concept
- "How do I do X?" -> read a pattern
- "How does feature X work end-to-end?" -> read a feature

Rules:

- **Docs first**: ALWAYS read the domain documentation BEFORE exploring source code. It is the authoritative source for understanding the system; source code is the second resort.
- **No documentation updates during implementation**: do NOT update the domain documentation when making code changes. It is maintained separately by Saaga.
- **Consult before implementing**: before implementing new features or changes, check the existing concepts and patterns to reuse existing services/modules instead of reinventing them.
