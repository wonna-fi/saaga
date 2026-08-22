## Decision Guidance

### Is it a Concept, Pattern, or Feature?

| Type | Definition | Example |
| --- | --- | --- |
| **Concept** | A building block or domain term used by multiple features. Answers "what is X and where does it live?" | Authentication State, Navigation Structure, API Client |
| **Pattern** | A reusable code approach for a common operation. Answers "how do I do X?" | Making API calls, Creating new screens, Handling errors |
| **Feature** | A user-facing capability with a complete flow. Answers "how does feature X work end-to-end?" | User Login, QR Code Scanning, Visit History |

**Rule of thumb:**

- If it's referenced by 3+ features → probably a **Concept**
- If it's a "how to" with code → probably a **Pattern**
- If a user would recognize it as something they do → probably a **Feature**

### How Detailed Should Each Doc Be?

| Type | Target Length | Must Answer |
| --- | --- | --- |
| **Concept** | 50-150 lines | What is it? Where is it configured? How do I access it? What are the gotchas? |
| **Pattern** | 50-100 lines | When do I use this? What's the code? What mistakes should I avoid? |
| **Feature** | 100-250 lines | What does it do? What's the user flow? What's the technical implementation? How do I extend it? |

### When to Stop Researching

Stop researching and start writing when you can:

1. Explain the concept/pattern/feature in one sentence
2. Point to the primary source file(s)
3. Identify at least one reference implementation
4. List the key fields/methods involved

If you cannot do all four after reading the listed key files + related files, note the gaps and proceed with what you know.
