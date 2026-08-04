# Cost Confirmation

## Business Definition

Cost confirmation is the interactive disclaimer flow that runs before every agent-backed subcommand (`init`, `update`, `quick-update`, `verify-quick-updates`). It informs the user that the session will invoke a third-party agent CLI, that token usage is billed to the user's own account with that provider, and provides a per-subcommand cost hint. On interactive terminals the user must type `y` or `yes` to proceed; the prompt can be bypassed with the `--yes` flag, the `autoApprove` config field, or by running in a non-interactive environment.

## Configuration

| Source | Description |
|--------|-------------|
| `--yes` flag (`-y`) | CLI flag that auto-approves the cost confirmation for the current invocation |
| `.saaga/config.yaml` `autoApprove` field | Persistent project-level auto-approval (see [Project Configuration](./project-configuration.md)) |
| `--ci` flag | Implicitly non-interactive; notice is printed but no prompt is shown |

**How to access:**

- `confirmAgentCosts(input)` — displays the cost notice and, when interactive, prompts for confirmation; throws `ConfirmationDeclinedError` on decline
- `buildCostNotice(input)` — builds the multi-line cost disclaimer string without performing any I/O
- `buildCostSummary(input)` — builds a one-line summary string for run log output

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `CostNoticeInput` | `subcommand` | Name of the subcommand being run (used to look up cost hint) |
| `CostNoticeInput` | `appPath` | Path to the application directory being documented |
| `CostNoticeInput` | `backendCli` | Name of the CLI binary that will be executed (e.g. `"cursor-agent"`, `"copilot"`, `"claude"`) |
| `CostNoticeInput` | `backend` | Optional resolved backend key; absent when the agent was injected directly |
| `CostNoticeInput` | `model` | Optional resolved model name; absent when the agent was injected directly |
| `CostConfirmationInput` | _(extends `CostNoticeInput`)_ | Inherits all fields from `CostNoticeInput` |
| `CostConfirmationInput` | `autoApprove` | Whether to skip the interactive prompt (`--yes` flag or `config.autoApprove`) |
| `CostConfirmationInput` | `ci` | Whether `--ci` mode is active |
| `CostConfirmationInput` | `stdin` | Optional readable stream for the interactive prompt |
| `CostConfirmationInput` | `stream` | Writable stream for output (typically stderr) |
| `ConfirmationDeclinedError` | `exitCode` | Always `1` — the process exit code when the user declines |
| `ConfirmationDeclinedError` | `message` | Default: `"aborted: cost confirmation declined"` |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/cli/confirm.ts` | `confirmAgentCosts()` | Show the cost disclaimer and prompt for confirmation; throws `ConfirmationDeclinedError` on decline |
| `src/cli/confirm.ts` | `buildCostNotice()` | Build the multi-line cost notice string from a `CostNoticeInput` |
| `src/cli/confirm.ts` | `buildCostSummary()` | Build a one-line cost summary string for log output (format: `cost notice acknowledged (cli=<name>)` or `cost notice acknowledged (cli=<name>, model=<model>)` when a model is resolved) |
| `src/cli/confirm.ts` | `ConfirmationDeclinedError` (class) | Error thrown when the user declines the cost confirmation; carries `exitCode = 1` |
| `src/cli/confirm.ts` | `CostNoticeInput` (interface) | Input shape for `buildCostNotice()` and `buildCostSummary()` |
| `src/cli/confirm.ts` | `CostConfirmationInput` (interface) | Extended input shape for `confirmAgentCosts()`: adds `autoApprove`, `ci`, `stdin`, and `stream` |

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `describeResolution()` in `src/cli/confirm.ts` — formats the `(backend <name>, model <name>)` parenthetical segment of the cost notice; returns an empty string when neither backend nor model is set
> - `isInteractive()` in `src/cli/confirm.ts` — determines whether the terminal is interactive: returns `false` when `ci` is true, when `stdin` is absent, or when `stdin.isTTY` is not `true`
> - `ask()` in `src/cli/confirm.ts` — creates a `readline` interface, shows the `"Continue? [y/N] "` prompt, and returns `true` only for `"y"` or `"yes"` (case-insensitive); handles EOF by racing a close-event promise against the question

### Internal Constants

| Constant | Purpose |
|----------|---------|
| `PROMPT` | The confirmation prompt string: `"Continue? [y/N] "` |
| `COST_HINTS` | Maps subcommand names to cost expectation strings. Keys: `init` (heaviest command, large one-time token spend), `update` (scales with change size), `quick-update` (single session, cheapest agent command), `verify-quick-updates` (scales with number of pending quick updates) |

## Confirmation Flow

The `confirmAgentCosts()` function follows this decision tree:

1. **Auto-approve** (`autoApprove: true`): writes the cost notice followed by `"Confirmation auto-approved."` and returns immediately
2. **Not auto-approved**: writes the cost notice followed by a hint about `--yes` and `autoApprove: true`
3. **Non-interactive** (`ci` is true, `stdin` is absent, or `stdin.isTTY` is not true): writes `"Non-interactive terminal: continuing without confirmation."` and returns
4. **Interactive**: shows the `"Continue? [y/N] "` prompt and waits for input
   - `"y"` or `"yes"` (case-insensitive) → returns (confirmation accepted)
   - Any other input or EOF → throws `ConfirmationDeclinedError`

### Auto-Approve Resolution

The effective `autoApprove` value passed to `confirmAgentCosts()` is resolved in `src/cli.ts`:

```
--yes flag  →  config.autoApprove  →  false
```

## Error Handling

| Scenario | Error |
|----------|-------|
| User types anything other than `y`/`yes` | `ConfirmationDeclinedError: "aborted: cost confirmation declined"` |
| Stdin closes (EOF) before answer | `ConfirmationDeclinedError: "aborted: cost confirmation declined"` |

The `ConfirmationDeclinedError` is caught in `runCli()` in `src/cli.ts`: the error message is written to stderr and the CLI exits with code 1.

## Reference Implementations

- `src/cli/confirm.ts` — the canonical module containing the cost notice builder, confirmation prompt, and error class
- `src/cli.ts` — integration point: builds `CostNoticeInput` from resolved backend/model, calls `confirmAgentCosts()`, logs `buildCostSummary()` as a detail line, and handles `ConfirmationDeclinedError`
- `tests/cli/cost-confirmation.test.ts` — test suite covering auto-approve, interactive accept/decline, non-interactive bypass, CI mode, and cost hint content

## Related Concepts

- [Project Configuration](./project-configuration.md) — the `autoApprove` field provides persistent auto-approval
- [Backend Resolution](./backend-resolution.md) — provides the `backend` and `model` values shown in the cost notice; `backendCliCommand()` maps the backend to its CLI binary name
