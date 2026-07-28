#!/usr/bin/env bash
# Saaga agent install hook.
#
# This file is intentionally empty in the shipped template. Replace its
# body (or copy from one of the helpers under examples/install-agents/)
# to install the agent backends you need:
#
#   bash ../examples/install-agents/install-cursor-agent.sh
#   bash ../examples/install-agents/install-copilot.sh
#   bash ../examples/install-agents/install-claude.sh
#
# The hook runs once at devcontainer creation via `postCreateCommand`.

set -euo pipefail

# Install all supported agent backends.

## Cursor
curl https://cursor.com/install -fsS | bash
"$HOME/.local/bin/cursor-agent" --version

## Claude Code
curl -fsSL https://claude.ai/install.sh | bash
"$HOME/.local/bin/claude" --version

## GH Copilot
curl -fsSL https://gh.io/copilot-install | bash
"$HOME/.local/bin/copilot" --version

# Install the published Saaga CLI globally so `saaga` is available alongside
# the from-source development version run via `pnpm dev`.
npm install -g @wonna/saaga
saaga --version

# Every agent backend picks its token up from the environment on its own, so there
# is no login step to run here. Report what is available instead of probing for credentials,
# since a probe without credentials would fail the whole hook.
report_credential() {
  local backend=$1 var=$2 fallback=$3
  if [ -n "${!var:-}" ]; then
    printf '  %-8s %s is set\n' "$backend" "$var"
  else
    printf '  %-8s %s is empty — sign in with: %s\n' "$backend" "$var" "$fallback"
  fi
}

echo
echo "Agent credentials:"
report_credential cursor CURSOR_API_KEY "cursor-agent login"
report_credential copilot COPILOT_GITHUB_TOKEN "copilot, then /login"
report_credential claude ANTHROPIC_API_KEY "claude, then /login"
