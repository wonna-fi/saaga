## Decision Guidance

### Is it a Concept, Pattern, Convention, or Feature?

| Type | Definition | Example |
| --- | --- | --- |
| **Concept** | A building block or domain term used by multiple features. Answers "what is X and where does it live?" | Authentication State, Navigation Structure, API Client |
| **Pattern** | A reusable code approach for a common operation. Answers "how do I do X?" | Making API calls, Creating new screens, Handling errors |
| **Convention** | A lexical or structural rule the codebase holds itself to. Answers "what must X be named or shaped like?" | Naming, File layout, Error messages |
| **Feature** | A capability with a complete flow — user-facing (User Flow) or internal machinery (Mechanism). Answers "how does X work end-to-end?" | User Login, QR Code Scanning, Flow Execution |

**The line between a pattern and a convention.**
A rule that requires reading code flow is a **pattern**.
A rule you could check with grep is a **convention**.
The rule has exactly one home: content that moves into a convention file is
deleted from the pattern it came from, not copied.

**Rule of thumb:**

- If it's referenced by 3+ features → probably a **Concept**
- If it's a "how to" with code → probably a **Pattern**
- If it's a rule about names, paths, or wording → probably a **Convention**
- If a user would recognize it as something they do → probably a **Feature**

Internal machinery with a step-by-step flow is a **Feature**, documented under
`### Mechanism`. Fold it into the feature document that already covers that
machinery; a new document needs a new subject, not merely a new mechanism.

### What Must Each Doc Answer?

| Type | Must Answer |
| --- | --- |
| **Concept** | What is it? Where is it configured? How do I access it? What are the gotchas? |
| **Pattern** | When do I use this? What's the code? What mistakes should I avoid? |
| **Convention** | What is the rule? What does obeying it look like, and breaking it? Where does it apply? |
| **Feature** | What does it do? What's the flow? What's the technical implementation? How do I extend it? |

There is no uniform target length. Length is set per document by the budget the plan
assigns it — see Level of Detail. Convention documents are the exception: they are
capped at 5–20 lines of body and take no budget.

### When to Stop Researching

Stop researching and start writing when you can:

1. Explain the concept/pattern/convention/feature in one sentence
2. Point to the primary source file(s)
3. Identify at least one reference implementation
4. List the key fields/methods involved

If you cannot do all four after reading the listed key files + related files, note the gaps and proceed with what you know.
