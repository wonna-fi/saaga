#!/usr/bin/env bash
# Install GitHub Copilot CLI (used with backend: copilot).
# Mirrors the install RUN line from the legacy root Dockerfile.
set -euo pipefail
curl -fsSL https://gh.io/copilot-install | bash
copilot version
