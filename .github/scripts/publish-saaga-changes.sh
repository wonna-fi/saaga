#!/usr/bin/env bash
# publish-saaga-changes.sh — commit Saaga output and route it to main or a PR.
#
# Usage: publish-saaga-changes.sh <github-app-token> <app-slug> <source-label>
#
#   github-app-token  A short-lived GitHub App installation token with
#                     contents:write and pull-requests:write scopes.
#   app-slug          The GitHub App slug (from create-github-app-token output).
#   source-label      Human label for commit messages (e.g. "quick-update").
#
# Behaviour:
#   1. Stages all changed/new/deleted non-ignored files.
#   2. Exits 0 if the working tree is clean (nothing to publish).
#   3. Fetches origin/main and fails if the local HEAD is behind, so the
#      caller can rerun against a fresh checkout.
#   4. If every staged path is under saaga-docs/, commits and pushes to main.
#   5. Otherwise creates a branch and opens a PR for human review.
set -euo pipefail

TOKEN="${1:?usage: publish-saaga-changes.sh <token> <app-slug> <source-label>}"
APP_SLUG="${2:?usage: publish-saaga-changes.sh <token> <app-slug> <source-label>}"
SOURCE="${3:?usage: publish-saaga-changes.sh <token> <app-slug> <source-label>}"

# ── Stage all output ────────────────────────────────────────────────
git add -A

if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

# ── Configure git identity from the App slug ─────────────────────────
APP_USER_ID=$(gh api "/users/${APP_SLUG}[bot]" --jq '.id')

git config user.name "${APP_SLUG}[bot]"
git config user.email "${APP_USER_ID}+${APP_SLUG}[bot]@users.noreply.github.com"

# Use the App token for push and gh operations.
git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

# ── Stale-main guard ────────────────────────────────────────────────
git fetch origin main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "::error::Local HEAD ($LOCAL_SHA) does not match origin/main ($REMOTE_SHA). main advanced during the run. Re-run this workflow against the latest main."
  exit 1
fi

# ── Classify changes ────────────────────────────────────────────────
DOCS_ONLY=true
while IFS= read -r path; do
  case "$path" in
    saaga-docs/*) ;;
    *) DOCS_ONLY=false; break ;;
  esac
done < <(git diff --cached --name-only)

COMMIT_MSG="chore(docs): saaga ${SOURCE} $(date -u +%Y-%m-%d)"

# ── Publish ─────────────────────────────────────────────────────────
if [ "$DOCS_ONLY" = true ]; then
  echo "All changes under saaga-docs/ — pushing directly to main."
  git commit -m "$COMMIT_MSG"
  git push origin main
else
  BRANCH="saaga/${SOURCE}-$(date -u +%Y%m%d-%H%M%S)-${GITHUB_RUN_ID}"
  echo "Changes outside saaga-docs/ detected — opening PR on branch ${BRANCH}."
  git checkout -b "$BRANCH"
  git commit -m "$COMMIT_MSG"
  git push -u origin "$BRANCH"
  gh pr create \
    --base main \
    --title "$COMMIT_MSG" \
    --body "Automated documentation update from \`saaga ${SOURCE}\`. Changes outside \`saaga-docs/\` require review."
fi
