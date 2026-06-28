# Feature: Architecture Generation

## Overview

The `architecture` command generates a comprehensive architecture document (`docs/ARCHITECTURE.md`) for an application by invoking an AI agent with a structured prompt. It is the simplest workflow — a single agent step — and also serves as the first step of the `init` workflow.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Prompt Templates](../concepts/prompt-templates.md)
- [Agent Interface](../concepts/agent-interface.md)

## Functional Specification

### User Flow

1. User runs `saaga architecture [dir]` (dir defaults to the current working directory)
2. CLI resolves the agent backend and creates a run context
3. Agent is invoked with the `document-architecture` prompt
4. Agent analyzes the codebase and writes `docs/ARCHITECTURE.md`
5. Execution completes

### What the Agent Produces

The `document-architecture` prompt instructs the agent to:

1. Analyze the project structure and identify modules/components
2. Create a quality rubric with binary evaluation criteria
3. Save a temporary file listing the project structure as a checklist
4. Write an "Overall Architecture" section
5. Write a "Modules" section describing each module's public interface
6. Verify completeness against the structure listing
7. Self-assess using the rubric and fix any quality gaps

The resulting `docs/ARCHITECTURE.md` contains:
- **Overall Architecture**: high-level system description
- **Modules**: per-module descriptions with public interfaces and dependencies

### Scope Exclusions

If a `.saagaignore` file exists at the project root, the agent omits files and directories matching those patterns from the architecture overview.

### Validation Rules

- `dir` must exist and be a directory (defaults to current working directory if omitted)
- A backend must be resolvable via `--backend` flag or `.saaga/config.yaml`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory does not exist | Throws `Error: Directory not found: <dir>` |
| Path is not a directory | Throws `Error: Not a directory: <dir>` |
| Agent step exits non-zero | Throws `AgentStepFailedError`, CLI returns the exit code |
| `.saagaignore` exists | Agent skips matching paths in the architecture overview |
| `docs/` directory doesn't exist | Agent creates it before writing `ARCHITECTURE.md` |

## Technical Implementation

### Flow File

`flows/architecture.flow.yaml` — the simplest flow, containing a single step:

```yaml
name: architecture
steps:
  - agent:
      prompt: document-architecture
      vars:
        app: ${app}
```

### Initial Scope

| Variable | Value |
|----------|-------|
| `${app}` | Application directory basename |
| `${app_path}` | Absolute path to the application directory |
| `${run_id}` | Unique run identifier (format: `<app>-architecture-<YYYYMMDD>-<HHMMSS>-<hex>`) |
| `${run_dir}` | Absolute path to the run artifacts directory |
| `${date}` | Run date formatted as YYYYMMDD |

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point, parses `architecture` subcommand |
| `src/engine/runner.ts` | `runFlow()` | Executes the single-step flow |
| `src/engine/loader.ts` | `loadFlow()` | Loads `flows/architecture.flow.yaml` |
| `src/run-context.ts` | `createRunContext()` | Creates run ID and run directory |
| `src/templates.ts` | `renderPromptFile()` | Renders the architecture prompt template |

### Prompt Template

`prompts/document-architecture.md` — accepts one placeholder:

| Placeholder | Source |
|-------------|--------|
| `{app}` | `${app}` from the flow's initial scope (application directory basename) |

The prompt instructs the agent to:
- Write the document to `docs/ARCHITECTURE.md`
- Describe modules in terms of public interfaces (not internal implementation)
- Use mermaid charts with accessible colors for diagrams
- Respect `.saagaignore` exclusions

## Integration Points

- **Depends on**: Agent backend (Cursor, Copilot, or Claude), `prompts/document-architecture.md` template
- **Used by**: Standalone `architecture` command; also the first step of the `init` workflow
- **External systems**: External agent CLIs (`cursor-agent`, `copilot`, `claude`)

## Extension Guide

To modify architecture generation:

1. **Add additional output files**: Edit the prompt template to instruct the agent to produce more files (e.g., a diagrams file)
2. **Add verification**: Insert a verify/fix loop after the agent step (similar to the slice flow pattern)
3. **Change prompt structure**: Edit `prompts/document-architecture.md` to adjust what sections the architecture doc should contain
