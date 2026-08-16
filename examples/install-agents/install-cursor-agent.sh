#!/usr/bin/env bash
# Install cursor-agent CLI (used with backend: cursor).
# Mirrors the install RUN line from the legacy root Dockerfile.
set -euo pipefail
curl https://cursor.com/install -fsS | bash
"$HOME/.local/bin/cursor-agent" --version
