# Package Paths

## Business Definition

The package paths module provides four constants that anchor all file resolution to the Saaga package root. These constants ensure that flow YAML files and prompt templates are found correctly regardless of whether the code runs from TypeScript source (via `tsx` in development) or from compiled JavaScript (via `dist/` in production).

## Configuration

| Source | Description |
|--------|-------------|
| `import.meta.url` | Used to determine the current file's location at runtime |
| Directory layout convention | Both `src/` and `dist/` sit directly under the package root, so `resolve(here, "..")` always reaches the root |

**How to access:**

Import the constants directly from `src/paths.ts`:

```typescript
import { PACKAGE_ROOT, FLOWS_DIR, PROMPTS_DIR, RULES_DIR } from "./paths.js";
```

## Data Storage

| Constant | Value | Purpose |
|----------|-------|---------|
| `PACKAGE_ROOT` | `resolve(dirname(fileURLToPath(import.meta.url)), "..")` | Absolute path to the package root directory |
| `FLOWS_DIR` | `resolve(PACKAGE_ROOT, "flows")` | Absolute path to the `flows/` directory containing flow YAML files |
| `PROMPTS_DIR` | `resolve(PACKAGE_ROOT, "prompts")` | Absolute path to the `prompts/` directory containing prompt template files |
| `RULES_DIR` | `resolve(PACKAGE_ROOT, "rules")` | Absolute path to the `rules/` directory containing rule template files |

## How It Works

The module uses `import.meta.url` to get the URL of the current source file, converts it to a filesystem path via `fileURLToPath()`, gets the parent directory with `dirname()`, then resolves one level up (`".."`) to reach the package root.

```
Package root (PACKAGE_ROOT)
├── src/
│   └── paths.ts          ← here = src/  → resolve("..")  = root ✓
├── dist/
│   └── paths.js          ← here = dist/ → resolve("..")  = root ✓
├── flows/                 ← FLOWS_DIR
│   ├── init.flow.yaml
│   ├── update.flow.yaml
│   ├── quick-update.flow.yaml
│   └── verify-quick-updates.flow.yaml
├── prompts/               ← PROMPTS_DIR
│   ├── document-architecture.md
│   ├── plan-init.md
│   └── ...
└── rules/                 ← RULES_DIR
    ├── rule-stub.md
    ├── cursor-rule.mdc
    └── copilot-rule.md
```

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/paths.ts` | `PACKAGE_ROOT` (const) | Absolute path to the package root |
| `src/paths.ts` | `FLOWS_DIR` (const) | Absolute path to the `flows/` directory |
| `src/paths.ts` | `PROMPTS_DIR` (const) | Absolute path to the `prompts/` directory |
| `src/paths.ts` | `RULES_DIR` (const) | Absolute path to the `rules/` directory |

## Consumers

| Module | Usage |
|--------|-------|
| `src/engine/loader.ts` | Uses `FLOWS_DIR` to locate flow YAML files by name |
| `src/engine/runner.ts` | Uses `PROMPTS_DIR` to resolve prompt template paths for agent steps |
| `src/cli.ts` | Uses `PACKAGE_ROOT` to read `package.json` for `--version` output |
| `src/scripts/install-rules.ts` | Uses `RULES_DIR` to locate rule template files |

## Related Concepts

- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Agent Interface](./agent-interface.md)
