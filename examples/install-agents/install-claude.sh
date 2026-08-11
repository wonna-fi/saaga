#!/usr/bin/env bash
# Install Claude Code CLI (used with backend: claude).
#
# Supports version pinning via CLAUDE_CODE_VERSION env var. When set,
# installs that exact version via npm to ensure reproducible CI runs.
# When unset, installs the latest via the official installer.
set -euo pipefail

if [ -n "${CLAUDE_CODE_VERSION:-}" ]; then
  npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
else
  curl -fsSL https://claude.ai/install.sh | bash
fi

# Verify — npm puts the binary on the node PATH, the official installer
# uses ~/.local/bin.
claude --version 2>/dev/null || "$HOME/.local/bin/claude" --version
