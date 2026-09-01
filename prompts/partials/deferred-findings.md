### THE DEFERRED-FINDINGS REPORT

Write the report to `{deferred_minors_path}`. Exactly one verification writes
this file — the round that ends this slice — so write it once, complete, with
this header:

```markdown
# Deferred Findings

Findings this run recorded but never verified as resolved: minors a slice
passed with, and final-round findings whose fix nothing re-checked. An entry is
pending until its document is verified again: pending means the document still
exists and its frontmatter still has no `last_verified`. Recorded {date}.

| Document | Section | Claim | Severity | Evidence | Verdict | Review |
|---|---|---|---|---|---|---|
```

Then one row per finding. Copy Document, Section, Claim, Evidence and Severity
from your findings table verbatim: whoever reads this file later re-checks the
finding against the document as it stands then, and can only re-check what the
row says. `Verdict` is `PASS (minor deferred)` or
`FAIL (round {iteration} of {loop_max})`. `Review` is the report you wrote in
Step 5, `{review_path}`, where the finding is written out in full.

Leave out any row whose Document is `README.md` or `GLOSSARY.md`. Both are
regenerated from the corpus on every run and can never carry a `last_verified`,
so an entry for one would be pending forever.

Keep a row whose Document is marked `(missing)`. The fix step may still create
that document, and it will have no stamp when it does, so the row is the only
record of why it is pending. If the document is never created the entry simply
never matches: a reader checks that the document exists before acting on it.

Writing a row is never a substitute for the stamp rule in Step 7, and never an
edit to the document itself. The round number changes what you record, not what
you find: grade a finding on the last round exactly as you would have graded it
on the first.
