## Quality Checklists

### Concept Doc Checklist

- Business definition is understandable to someone unfamiliar with the codebase
- Configuration source is specified and verified (file/object/variable actually exists)
- "How to access" includes the correct module and function/method
- Data storage/model section lists all relevant fields
- At least 2 reference implementations are cited
- All referenced files/functions actually exist in the codebase
- Related concepts are linked (if any exist)
- **[VERIFICATION]** All constants/values lists are complete (check source-of-truth file)
- **[MANDATORY]** For EVERY function in "Key Services/Functions": Verify it is part of the public API
- **[MANDATORY]** Internal functions are NOT in "Key Services/Functions" — move to "Internal Implementation" section
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about

### Pattern Doc Checklist

- "When to use" clearly describes the use cases
- Code example is complete and would work as-is
- Code example includes comments explaining each step
- Key points highlight non-obvious things an implementer might miss
- At least 2 reference implementations are cited
- Anti-patterns section warns about common mistakes
- All referenced files/functions actually exist in the codebase
- **[VERIFICATION]** Function parameter types match actual signatures
- **[MANDATORY]** For EVERY function in "Reference Implementations": Verify it is part of the public API
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about

### Feature Doc Checklist

- Overview is understandable to a non-technical person
- Key concepts section links to relevant concept docs (or notes they need to be created)
- User flow matches what actually happens (verify against code)
- Validation rules are complete (check the service/controller/store code)
- Edge cases include error messages (check for error handling)
- Technical implementation lists all involved services/components
- Extension guide provides actionable steps for building similar features
- **[VERIFICATION]** All component/screen names actually exist (search the codebase)
- **[VERIFICATION]** Behavior claims are consistent with other docs in the slice
- **[MANDATORY]** For EVERY function in "Services/Functions" table: Verify it is part of the public API
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about
