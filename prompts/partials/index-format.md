INDEX.md format:

```markdown
---
title: "{Type} Index"
type: index
---

# {Type} Index

| Name | Description |
|------|-------------|
| [Example](./example.md) | Brief description |
```

Never create `{docs_dir}/README.md` or `{docs_dir}/GLOSSARY.md`. Saaga generates
both from the INDEX files after every run and overwrites anything written there.
