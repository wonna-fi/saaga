### Domain Documentation ({app})

This codebase has structured domain documentation under `{docs_dir}/`, organized into four types:

| Type | Index | Answers |
|------|-------|---------|
| Concepts | `{docs_dir}/concepts/INDEX.md` | What something is and where it lives |
| Patterns | `{docs_dir}/patterns/INDEX.md` | How to do common operations — anything that takes reading a code flow to follow |
| Conventions | `{docs_dir}/conventions/INDEX.md` | What things must be named or shaped like — the rules you could check with grep |
| Features | `{docs_dir}/features/INDEX.md` | How a feature works end-to-end, user-facing or internal machinery |

Classify your question, open the matching `INDEX.md`, and read the relevant document(s):

- "What is X / where does X live?" -> read a concept
- "How do I do X?" -> read a pattern
- "What do I call X / where does the file go?" -> read a convention
- "How does feature X work end-to-end?" -> read a feature

Not every codebase has conventions; the category is present only when there are rules worth stating.

Rules:

- **Docs first**: ALWAYS read the domain documentation BEFORE exploring source code. It is the authoritative source for understanding the system; source code is the second resort.
- **No documentation updates during implementation**: do NOT update the domain documentation when making code changes. It is maintained separately by Saaga.
- **Consult before implementing**: before implementing new features or changes, check the existing concepts and patterns to reuse existing services/modules instead of reinventing them.
