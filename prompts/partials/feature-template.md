### FEATURE TEMPLATE

File location: `{docs_dir}/features/{feature-name}.md`

```markdown
# Feature: {Feature Name}

## Overview

{1-2 sentences describing what this feature does from a user perspective}

## Key Concepts

Before working with this feature, understand these concepts:
- [{Concept 1}](../concepts/concept-1.md)
- [{Concept 2}](../concepts/concept-2.md)

## Functional Specification

### User Flow

1. {Step 1 of the user journey}
2. {Step 2}
3. {Step 3}

### Validation Rules

- {Validation rule 1}
- {Validation rule 2}

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| {Edge case} | {What happens} |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `{ModelName}` | `{field1}`, `{field2}` | {Purpose} |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `{ModuleName}` | `{method}()` | {What it does} |

### Screens/Components (if applicable)

| Component | Purpose |
|-----------|---------|
| `{ComponentName}` | {What it does} |

### API Calls (if applicable)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/path` | POST | {What it does} |

## Integration Points

- **Depends on**: {Features/services this feature requires}
- **Used by**: {Features that use this feature}
- **External systems**: {Third-party integrations involved}

## Extension Guide

{How to extend or build upon this feature}
```
