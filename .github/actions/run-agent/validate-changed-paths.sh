#!/usr/bin/env bash

set -euo pipefail

while IFS= read -r -d '' file; do
  case "$file" in
    .github/workflows/* | .github/actions/* | .opencode/* | opencode.json | opencode.jsonc | script/translate-app.ts | \
    AGENTS.md | */AGENTS.md | CLAUDE.md | */CLAUDE.md | CONTEXT.md | */CONTEXT.md)
      echo "::error::Autonomous resolver PRs may not modify trusted automation input '$file'."
      exit 1
      ;;
  esac
done
