## Quality Checklists

### Concept Doc Checklist

- Business definition is understandable to someone unfamiliar with the codebase
- Configuration source is specified and verified (file/object/variable actually exists)
- "How to access" includes the correct module and function/method
- Data storage/model section lists the fields a caller needs; internal fields only if they pass the consequence test
- Reference implementations are cited (one is enough when only one exists)
- All referenced files/functions actually exist in the codebase
- Related concepts are linked (if any exist)
- **[VERIFICATION]** Any constants list the document *does* carry is complete and matches the source-of-truth file. A private constant's literal value is carried only if it passes the consequence test.
- **[MANDATORY]** For EVERY function in "Key Services/Functions": Verify it is part of the public API
- **[MANDATORY]** Internal functions are NOT in "Key Services/Functions" — remove them, unless the consequence test justifies naming one under "Internal Implementation"
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about
- **[VERIFICATION]** Document's length was checked against its assigned line budget (the verification step defines the tolerance; being a little over is not by itself an error)
- **[VERIFICATION]** Every internal mechanism documented in full passes the consequence test

### Pattern Doc Checklist

- "When to use" clearly describes the use cases
- Code example is complete and would work as-is
- Code example includes comments explaining each step
- Key points highlight non-obvious things an implementer might miss
- Reference implementations are cited (one is enough when only one exists)
- Anti-patterns section warns about common mistakes
- All referenced files/functions actually exist in the codebase
- **[VERIFICATION]** Function parameter types match actual signatures
- **[MANDATORY]** For EVERY function in "Reference Implementations": Verify it is part of the public API
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about
- **[VERIFICATION]** Document's length was checked against its assigned line budget (the verification step defines the tolerance; being a little over is not by itself an error)
- **[VERIFICATION]** Every internal mechanism documented in full passes the consequence test

### Feature Doc Checklist

- Overview is understandable to a non-technical person
- Key concepts section links to relevant concept docs (or notes they need to be created)
- User flow matches what actually happens (verify against code)
- Validation rules are complete (check the service/controller/store code)
- Edge cases include error messages (check for error handling)
- Technical implementation lists the services/components a reader must know about — not every file touched
- Extension guide provides actionable steps for building similar features
- **[VERIFICATION]** All component/screen names actually exist (search the codebase)
- **[VERIFICATION]** Behavior claims are consistent with other docs in the slice
- **[MANDATORY]** For EVERY function in "Services/Functions" table: Verify it is part of the public API
- **[VERIFICATION]** Frontmatter `sources` lists every file the document makes a claim about
- **[VERIFICATION]** Document's length was checked against its assigned line budget (the verification step defines the tolerance; being a little over is not by itself an error)
- **[VERIFICATION]** Every internal mechanism documented in full passes the consequence test
