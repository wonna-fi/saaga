## Mandatory Verification Protocol

**Golden Rule: If you cannot find evidence for a claim in the source code, do NOT document it as fact.**

Execute this protocol before marking any document as complete.

**Step 1: Key Services/Functions Verification** - For EVERY function/method listed in a "Key Services/Functions" table, search the source file and verify it is part of the public API. If not public/exported, remove it from the table. Add it to an "Internal Implementation" note only if it passes the consequence test; otherwise delete it.

**Step 2: Reference Implementation Verification** - For EVERY function listed in "Reference Implementations", verify it exists and check its accessibility. Public functions are listed by name; internal functions are referenced by file name with a note.

**Step 3: Document Review Checklist** - A final self-check confirming: every function name was searched in source, accessibility was verified for each, all public API items are correctly listed, and internal functions are properly noted.

**Step 4: Sources Completeness** - List every source file the document makes a signature or behavioural claim about, including any cited only under "Reference Implementations", and confirm each one appears in the frontmatter `sources`. A file the document merely mentions in passing does not need to be listed; a file whose change would make the document wrong does. An incomplete `sources` list is an error: it is what makes the document invisible to staleness detection later.

Adapt the specific verification commands to the technology (e.g., `Grep: "export.*functionName"` for TypeScript, `Grep: "public.*methodName"` for Apex/Java). The plan's **Template Adaptations** section records the checks chosen for this repository.

**Internal Consistency Check** - After completing all documents in a slice, cross-reference behavior descriptions across concept, pattern, and feature docs. Verify claims don't contradict each other, and record a finding against every document whose claim disagrees with the actual code behavior. Reviewing never edits a document to resolve the contradiction; the fix step does that, from the finding.

Final self-check questions:

1. Can you point to the exact line of code for every claim?
2. Have you actually read the source file (not just searched)?
3. Have you verified example outputs match actual behavior?
