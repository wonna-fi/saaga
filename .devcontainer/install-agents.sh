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
curl https://cursor.com/install -fsS | bash
"$HOME/.local/bin/cursor-agent" --version

curl -fsSL https://claude.ai/install.sh | bash
"$HOME/.local/bin/claude" --version
