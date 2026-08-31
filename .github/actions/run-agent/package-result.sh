#!/usr/bin/env bash
set -euo pipefail

COMMAND=${1:?command is required}
RESULT=${2:?result file is required}
OUTPUT=${3:?output directory is required}
BRANCH=${4:-}
BASE_SHA=${5:-}

install -d -m 700 "$OUTPUT"
install -m 600 "$RESULT" "$OUTPUT/result.md"

if [ "$COMMAND" = "agent-scan" ]; then
  exit 0
fi
if [ "$COMMAND" != "agent-resolve" ] || [ -z "$BRANCH" ] || [ -z "$BASE_SHA" ]; then
  echo "agent-resolve packaging requires a branch and base commit" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "agent-resolve must commit every tracked change before creating its result bundle" >&2
  git status --short >&2
  exit 1
fi

git bundle create "$OUTPUT/result.bundle" "refs/heads/$BRANCH" "^$BASE_SHA"
