---
generated: 2026-08-06T10:56:19.250Z
verified: false
docs_touched:
  - saaga-docs/concepts/script-registry.md
  - saaga-docs/features/quick-update-workflow.md
  - saaga-docs/features/flow-execution.md
confidence: high
---

## What changed

Commit 1c20dc8 introduced a new built-in script `cleanup-quick-update-dir` and modified the quick-update flow and runner to handle pre-created metadata directories more robustly:

1. **New script**: `src/scripts/cleanup-quick-update-dir.ts` — removes pre-created quick-update metadata folders when the agent writes `SKIPPED` rather than `UPDATED`; includes path-traversal attack protection
2. **Flow change**: `flows/quick-update.flow.yaml` — added a conditional branch that calls `cleanup-quick-update-dir` when status is not `UPDATED`
3. **Runner enhancement**: `src/engine/runner.ts` — `runAgentStep()` now pre-creates directories for any prompt variable that points to a write-permitted root (not just `run_dir`, but also `permissions.writeRoots`), ensuring the agent can write to expected paths without directory-not-found errors

## What was updated

1. **saaga-docs/concepts/script-registry.md**:
   - Added `cleanup-quick-update-dir` to the Registered Built-in Scripts table with description: "Removes a single pre-created quick-update metadata folder when the agent wrote SKIPPED rather than UPDATED; validates path safety to prevent path-traversal attacks"
   - Added reference implementation for `cleanup-quick-update-dir` in the Reference Implementations section

2. **saaga-docs/features/quick-update-workflow.md**:
   - Updated Key Concepts to include `cleanup-quick-update-dir` script
   - Updated User Flow to describe the pre-creation of the metadata directory (step 4) and the conditional cleanup (step 7)
   - Updated Validation Rules to include the pre-creation and cleanup behaviors
   - Updated Edge Cases table to reflect that the metadata folder is pre-created and then removed when status is `SKIPPED`
   - Updated Flow Execution step sequence to include the `cleanup-quick-update-dir` conditional branch
   - Added `cleanupQuickUpdateDir()` function to the Services/Functions table
   - Added `runAgentStep()` entry to Services/Functions table describing directory pre-creation
   - Updated Integration Points to include the cleanup script

3. **saaga-docs/features/flow-execution.md**:
   - Added step 4 to Agent Step Execution Detail: "Pre-creates directories for agent output paths: for any prompt var value that starts with a write-permitted root (`scope.run_dir` or `deps.permissions.writeRoots`), the parent directory is created recursively; this ensures the agent can write to expected paths without directory-not-found errors"

## Uncertainty areas

None. All changes are straightforward and well-defined in the source code. The new script has clear validation logic, the flow change is a simple conditional branch, and the runner enhancement is a focused expansion of existing directory pre-creation logic.
