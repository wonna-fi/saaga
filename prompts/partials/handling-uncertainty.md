## Handling Uncertainty

### When Code Logic is Unclear

If you cannot determine the business logic from the code:

1. Document what the code **does**, not what you **assume** it should do
2. Add a note: `> **Note:** This behavior is inferred from code analysis. Verify with domain expert if business intent is unclear.`
3. Still create the doc — partial documentation is better than none

### When Multiple Patterns Exist

If you find multiple ways to do the same thing:

1. Document the **most recent/common** pattern as the primary approach
2. Note alternatives: `> **Alternative:** Older code may use [X approach] — see [FileName]. New code should follow the pattern above.`

### When Information is Missing

If key information cannot be found:

1. Use placeholder with clear marker: `{TODO: Determine validation rules for X}`
2. Add to a "Gaps" section at the end of the doc:
   ```markdown
   ## Known Gaps

   - Validation rules for [X] not found in code — may be handled by the backend
   - Error messages not documented — check with QA
   ```

### When You Find Bugs or Inconsistencies

If you discover apparent bugs or inconsistencies while documenting:

1. Document the **current** behavior, not the "correct" behavior
2. Add a note: `> **Observation:** [Describe the inconsistency]. This may be intentional or a bug.`
3. Do not attempt to fix issues while documenting
