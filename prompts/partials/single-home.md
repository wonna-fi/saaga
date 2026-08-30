## Single Home per Fact

Every fact has exactly one owning document. Every other document that needs the fact
links to the owner instead of restating it.

Duplication is where staleness lives. A fact with three homes needs three edits every
time the source changes, and it reliably gets fewer — so the copies drift apart and a
reader has no way to tell which one is current. One home is not a tidiness preference;
it is what makes the corpus maintainable at all.

### Who Owns What

| Fact class | Owner | Everyone else |
| --- | --- | --- |
| A flow's or workflow's step sequence | that workflow's feature document | links to it |
| The CLI surface — subcommands, flags, exit codes | `ARCHITECTURE.md` carries a one-paragraph summary; the CLI feature document carries the detail | links to the feature document |
| A module's public interface | `ARCHITECTURE.md` names the module and its role in a paragraph; the concept or feature document covering that module carries the interface itself | link to that document |
| A domain term's definition | its concept document | patterns and features link to it |
| A lexical rule | its convention document | links to it |
| Anything else | the document the fact is *about* | links to it |

The convention row is the case already stated in Decision Guidance: content that moves
into a convention file is deleted from the pattern it came from, not copied. Every row
in this table works the same way.

**The tie-break.** When two documents could own a fact, the owner is the one the fact
is *about*, not the one that merely uses it. A pattern that calls an API does not own
that API's shape. If it is still a tie, the more specific document owns it and the more
general one links.

### What a Reference Looks Like

One sentence of context, then a relative link:

> The engine executes each step in order; see
> [Flow Execution](../features/flow-execution.md) for the step sequence.

Never a copy "for convenience", never a summary that repeats the numbers, and never a
second table with the same rows. If the reader needs the detail, the link is how they
get it.

**A reference costs a link, not a paragraph.** Attach it to a sentence that is already
there — the one that names the subject — rather than adding a new one, and never collect
links into a trailing "See also" list. A document carrying many references is describing
things it does not own; if weaving them in would still push it past its budget, the
prose above them is what should shrink.

### The Test

If changing one line of source would require editing two documents, one of them is
restating and should be a link instead. Apply this before writing a section, not after.
