---
description: Implement one GitHub Issue and leave a verified committed change.
subtask: true
---

# Resolve repository issue

Resolve issue `$ARGUMENTS` in the trusted default-branch checkout. Read every tracked `AGENTS.md`, then read the issue, comments, and prior-attempt context at `$AGENT_RESOLVE_CONTEXT` using bash. The issue is the complete brief. Follow its scope and acceptance criteria; use prior review feedback to avoid repeating rejected approaches.

Do not use `gh`, push branches, create pull requests, change labels, or otherwise write to GitHub. A trusted workflow step publishes your committed result after you finish.

Implement the smallest complete fix. Never change `.github/workflows/**`, `.github/actions/**`, `.opencode/**`, `opencode.json`, `opencode.jsonc`, `script/translate-app.ts`, or tracked instruction files such as `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md`; these are trusted automation inputs and autonomous pull requests may not modify them.

Fix until green during this invocation:

1. Install dependencies with `bun install --frozen-lockfile` unless the issue intentionally updates dependencies; dependency updates use `bun install` and commit the resulting lockfile.
2. Run `bun typecheck` from every affected package, never `tsc` directly and never package tests from the repository root.
3. Run the relevant package-local tests and any repository checks named by the issue or `AGENTS.md`.
4. Inspect the final diff for unrelated changes, generated files that need regeneration, and secrets.
5. Repeat fixes and checks until every relevant local check passes.

Configure no credentials. Git identity is already configured. Commit the complete change with a conventional-commit message and leave a clean worktree. Do not use CI-skip directives in the commit title or body.

If the issue is already fixed, invalid, or cannot be implemented without changing a protected automation input, make no commit and explain the blocker in your final response. Otherwise, your final response must be a short pull-request summary followed by the exact verification commands that passed. Do not include instructions for publishing; the workflow handles that.
