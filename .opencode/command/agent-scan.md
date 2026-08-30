---
description: Audit the repository and write one verified maintenance issue.
subtask: true
---

# Repository maintenance scan

Audit the trusted default-branch checkout and return exactly one GitHub Issue proposal. Do not create the issue yourself. A trusted workflow step publishes your final response.

Optional scope override: `$ARGUMENTS`

Start by reading every tracked `AGENTS.md`, then read the prefetched issue and pull-request context at `$AGENT_SCAN_CONTEXT`. Use bash to read that file. Do not file a duplicate of an open issue, a finding closed as not planned in the last 90 days, or a dependency update already covered by an open Dependabot PR.

Survey the whole repository except `.github/workflows/**`. Find the single highest-value task using this priority order:

1. Security problems, including vulnerable dependencies.
2. Correctness bugs.
3. Dead code and excessive or unnecessary tests.
4. Refactoring and code-quality improvements.
5. Missing tests.
6. Outdated or inconsistent repository `package.json` dependencies and metadata.

If `$ARGUMENTS` is non-empty, use it as the scan scope. Otherwise survey broadly. When findings have similar value, prefer a category that is under-represented in the recent issue context.

Verify the finding during this run. Read the relevant implementation and call sites, run the smallest commands that prove the claim, and record the actual commands and useful output. For package updates, check every workspace `package.json`, the shared catalog, current lockfile state, upstream release notes when needed, and open Dependabot PRs from the context. The proposed change must include `bun install` lockfile regeneration and relevant package-local verification. Never speculate about code you did not read.

The issue must let another agent implement the fix using only the issue and repository. Give one definitive approach, name the affected files, state what must not change, and make every acceptance criterion checkable. Do not implement the fix or modify tracked files.

Your final response must contain only one issue. The first line is a conventional-commit title (`fix(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `chore(deps): ...`, or `docs(scope): ...`). Follow it with a blank line and a concise body using this loose template:

```markdown
## Problem

What is wrong and why it matters.

## Evidence

File and line references, commands run, and the relevant output.

## Proposed change

The definitive implementation approach and named files.

## Acceptance criteria

- [ ] Observable, testable result.

## Out of scope

Explicit boundaries that prevent implementation drift.
```

Do not add preamble, alternatives, disclaimers, or a second finding.
