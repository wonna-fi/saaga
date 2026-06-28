#!/usr/bin/env bash
# Install Claude Code CLI (used with backend: claude).
set -euo pipefail
curl -fsSL https://claude.ai/install.sh | bash
"$HOME/.local/bin/claude" --version
