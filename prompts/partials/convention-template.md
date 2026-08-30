### CONVENTION TEMPLATE

File location: `{docs_dir}/conventions/{family}.md`

One file per convention *family* — naming, file layout, error messages — never per
rule. Body is 5–20 lines, frontmatter excluded. No `sources`: a rule, not a claim.

```markdown
---
title: {Family}
type: convention
---

# {Family}

- **Rule.** {What must be named or shaped this way}
- **Do.** `{conforming example}`
- **Don't.** `{counter-example}`
- **Applies to.** {paths or globs the rule governs}
```
