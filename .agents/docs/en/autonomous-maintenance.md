# Autonomous maintenance agents

Specification for two scheduled/event-driven OpenCode agents that maintain this repository without human prompting:

1. **Scanner** (`agent-scan`): once a day, audits the codebase and files exactly one detailed, verified GitHub Issue describing the single highest-value maintenance task it found.
2. **Resolver** (`agent-resolve`): when a human applies the `agent-resolve` label to an issue, implements the fix described by that issue and opens a pull request that closes it.

Status: approved design, produced from the design interview on 2026-08-30. Implementation lands as one integrated change.

Applies to (new files): `.github/workflows/agent-scan.yml`, `.github/workflows/agent-resolve.yml`, `.github/workflows/_agent-scan.yml`, `.github/workflows/_agent-resolve.yml`, `.github/actions/setup-opencode/action.yml`, `.opencode/command/agent-scan.md`, `.opencode/command/agent-resolve.md`. Applies to (modified files): `.github/workflows/_review-model.yml`, `.github/actions/run-opencode/action.yml` (setup extraction only). The review path (`pr-review.yml`, `pr-brief.yml`, `_opencode.yml`) is behaviorally untouched.

---

## 1. Principles

These decisions shape everything below and must not erode during implementation:

- **Trusted-step publishing.** Neither agent ever holds a GitHub write token or the App private key. Preflight, model execution, and publication run as separate jobs on fresh runners. The model uses a credential-free checkout with `persist-credentials: false`; it returns only an untrusted text or Git-bundle artifact. A fresh publishing job validates that artifact before minting and using a write token. A confused or prompt-injected model cannot poison a later privileged step on its runner.
- **Accepted credential posture.** Both agents get unrestricted bash. Executed code can therefore read `~/.local/share/opencode/auth.json`; this is accepted, not mitigated with new machinery, because the existing design already caps the blast radius: the CI credential carries `refresh: "ci-refresh-disabled"` (the real refresh token never reaches CI) and the setup lease check refuses to run unless the access token dies within `timeout + 10min`. The code executed is trusted default-branch code; the realistic adversary is only a misbehaving model. `external_directory: "deny"` still walls OpenCode's own file tools out of `$HOME`.
- **CI is the quality gate, not bespoke checks.** The resolver publishes draft-first and the existing PR CI (test, typecheck, knip, etc.) decides whether the PR becomes ready. No affected-package verification logic is duplicated into publish steps.
- **Humans steer with labels and merges.** Scanner issues do not auto-resolve. A human applies `agent-resolve` to authorize implementation (on any issue, scanner-created or hand-written). Every resolver PR then passes the automatic multi-model review and a human merge. Opt-out is closing the issue or the draft PR.
- **Mechanical invariants live in trusted steps.** The one-open-PR-per-issue guard, the queue gate, the trusted-automation-input push block, and branch naming are enforced by workflow steps and App permissions, never by prompt discipline alone.

## 2. Architecture overview

```
agent-scan.yml (cron 22:17 UTC / dispatch)
  resolve ── _review-model.yml (configuration: scan) ── SCAN_MODEL
  gate    ── skip when >= 10 open agent-task issues
  scan    ── _agent-scan.yml
               model (read-only token, trusted checkout, prefetch, command, artifact)
               -> publish (fresh runner, validate artifact, mint write token, create issue)

agent-resolve.yml (issues.labeled agent-resolve / dispatch)
  resolve ── _review-model.yml (configuration: resolve) ── RESOLVE_MODEL
  run     ── _agent-resolve.yml (issue number)
              preflight (safe runner, one-open-PR guard)
              -> model (read-only token, context, command, Git-bundle artifact)
              -> publish (fresh runner, validate bundle, mint write token)
              -> push agent-issue-{N} -> draft PR -> checks -> ready/red comment
```

Shared infrastructure:

- **`setup-opencode`** (new composite action): the shared trusted boundary for auth validation/merge, CLI version pin and cache, Bun/CLI install, model/variant verification, trusted command installation, plugin selection, and instruction assembly. It exposes the exact resolved CLI version and owns the generic result-extraction filter. `run-opencode` keeps only review-specific context, sandbox, invocation, and publication.
- **`_agent-scan.yml` and `_agent-resolve.yml`** (new reusable workflows): keep the two maintenance paths explicit instead of switching modes inside one large workflow. Both isolate untrusted model execution from trusted publication; the resolver also has a separate privileged preflight job.
- **`_review-model.yml`**: gains `scan` and `resolve` configurations (section 4).

## 3. The Hena Agent GitHub App

One dedicated App is the identity for both agents, decoupled from the provider map so authorship never changes when models are retuned.

| Permission    | Level          | Used for                                                         |
| ------------- | -------------- | ---------------------------------------------------------------- |
| Contents      | Read and write | Checkouts; resolver branch push                                  |
| Issues        | Read and write | Issue creation, labels, failure comments, queue-gate counting    |
| Pull requests | Read and write | Draft PR creation, ready flip, prior-attempt reads, guard checks |
| Checks        | Read-only      | Watching the draft PR's CI checks                                |
| Metadata      | Read-only      | Mandatory baseline                                               |

Deliberate exclusions: **no Workflows permission** — GitHub itself rejects any push touching `.github/workflows/**` from this App, mechanically preventing the autonomous pipeline from modifying CI. No organization or account permissions. Webhook disabled (the App is only a token mint). Installed only on this repository.

Registration follows the reviewer-App pattern: repository variable `HENA_AGENT_CLIENT_ID` holds the App client ID; repository secret `HENA_AGENT_PRIVATE_KEY` holds a generated private key.

## 4. Model configuration

`_review-model.yml` gains two configurations, following the `brief` single-model pattern:

| Configuration | Variable        | Default when unset            | Matrix       |
| ------------- | --------------- | ----------------------------- | ------------ |
| `scan`        | `SCAN_MODEL`    | `anthropic/claude-opus-5@max` | Single model |
| `resolve`     | `RESOLVE_MODEL` | `openai/gpt-5.6-sol@high`     | Single model |

- Entries use the mandatory `provider/model@variant` form; `off` disables that agent independently; deleting the variable restores the default. `REVIEWER_OPENCODE_VERSION` applies to these runs exactly as it does to reviews.
- The provider map is reused for `auth_secret` (which provider credential to restore), but for the `scan` and `resolve` configurations the resolver **overrides `client_id_var` to `HENA_AGENT_CLIENT_ID` and `private_key_secret` to `HENA_AGENT_PRIVATE_KEY`** — identity is configuration-derived, not provider-derived.
- Eligibility gates become event-aware: the `off` check always applies; the fork and Dependabot checks run when the event carries a pull-request number. PR events with an empty head repository (for example a deleted fork) remain disabled. On `schedule`, `workflow_dispatch`, and `issues` events the PR-only checks are skipped.

```sh
gh variable set SCAN_MODEL --body 'opencode-go/ox-alpha-free@max'
gh variable set RESOLVE_MODEL --body 'anthropic/claude-sonnet-5@max'

# Pause one agent without touching the other.
gh variable set SCAN_MODEL --body 'off'
gh variable delete SCAN_MODEL
```

## 5. Labels

| Label           | Meaning                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-task`    | Filed by the scanner. Inventory marker: counted by the queue gate and fed to future scans as dedupe context. Does not trigger anything.                                                                                                                 |
| `agent-resolve` | Human request: run the resolver on this issue. Remove and re-add to retry (GitHub fires `labeled` once per add, matching the `pr-review` re-run convention). Works on any open issue with a conventional-commit title, scanner-created or hand-written. |

Both use color `1D76DB` with descriptions matching the table. Repository setup provisions them once; scanner runs never overwrite label descriptions or colors.

## 6. Scanner (`agent-scan`)

### Triggers and topology

- `schedule`: `17 22 * * *` (22:17 UTC = 07:17 KST daily; odd minute dodges GitHub's top-of-hour cron congestion). The issue is ready before the Korean workday starts.
- `workflow_dispatch` with one optional input: `scope` — free-text category override (e.g., `security`) passed to the command as its argument.
- Jobs: `resolve` (model config) -> `gate` -> `scan` (via `_agent-scan.yml`). Concurrency group `agent-scan`, `cancel-in-progress: false` serializes normal cron/manual overlap.
- Timeout: 40 minutes.

### Queue gate

A cheap job (pr-brief `gate` pattern, `GITHUB_TOKEN` with `issues: read`) counts open issues labeled `agent-task`. At 10 or more, the scan is skipped before any model spend — backpressure when humans stop draining the queue.

### Context prefetch (read-only model job)

Written to files under `$RUNNER_TEMP`, paths exported as env vars for the command to read:

- Open `agent-task` issues: number, title, body.
- `agent-task` issues closed within the last 90 days: number, title, state reason. Closed-as-not-planned entries are human vetoes; the prompt forbids re-filing them. After the 90-day window a vetoed finding may resurface; re-veto or fix it.
- Open Dependabot PR titles, so dependency-update findings never duplicate a bump Dependabot already has in flight.

### Sandbox

`OPENCODE_PERMISSION`: `edit: deny`, `bash: allow` (unrestricted), `external_directory: deny`, `question: deny`, `todowrite: deny`. No GitHub token anywhere in the environment. Read-only-ness beyond the edit tool is prompt discipline; incidental workspace mutation is harmless because nothing publishes from this checkout.

### Mandate (command content)

- Survey the whole monorepo. `.github/workflows/**` is out of scope (the App cannot push it, so never file issues requiring workflow edits).
- **Priority ladder**: security > correctness bugs > dead code and excessive/unnecessary tests > refactoring and code quality > missing tests > dependency and `package.json` updates (outdated or inconsistent `package.json` entries across the monorepo; a security-driven bump ranks as security, and lockfile regeneration via `bun install` is part of the proposed change). File the single highest-value finding.
- **Diversity pressure**: the prefetched recent-issue context shows recently filed categories; prefer under-represented categories when value is comparable. A `scope` argument, when present, overrides category choice.
- **Verified means executed**: claims must be backed by evidence gathered this run — commands actually executed with their output (typecheck results, failing test repros, knip output, call-site searches), plus `file:line` citations. Never speculate about code not read.
- **Exactly one issue per run.** Not zero, not two. Dedupe against the prefetched open issues and vetoed findings.
- The issue must be implementable by a different agent from the issue text plus code access alone: no references to "as discussed" context that exists only in this run.

### Output contract and publish

Final message: first line is the issue title in conventional-commit form (`type(scope): summary`; the type doubles as the category signal — no category labels). The remainder is the body following a loose template the command prescribes: Problem, Evidence, Proposed change, Acceptance criteria, Out of scope. The publish step does **not** parse or validate sections — it splits title from body, prepends a hidden `<!-- agent-task {json} -->` metadata comment (category unknown to the step is omitted; model, variant, opencode version, run URL), and creates the issue with the `agent-task` label using the App token. Blank final output fails the run red with no issue. The step summary links the created issue.

## 7. Resolver (`agent-resolve`)

### Triggers and topology

- `issues: types: [labeled]`, gated to `github.event.label.name == 'agent-resolve'` and an open issue.
- `workflow_dispatch` with required input `issue` (number) as a testing/backup path.
- Jobs: `resolve` (model config) -> `run` (via `_agent-resolve.yml`, `issue` = issue number). Concurrency group `agent-resolve-${issue}`, `cancel-in-progress: false` — an impatient re-label queues, then exits cheaply at the guard, rather than killing a nearly-done implementation.
- Timeout: 60 minutes for the model job. The separate trusted publisher has a 25-minute cap, including up to 15 minutes of CI polling.

### Guard (trusted step, before model spend)

If an open PR with head branch `agent-issue-{N}` exists, comment on the issue linking it ("attempt already open; close it and re-label to retry") and exit successfully. This makes the open PR itself the claim — stateless, nothing to leak when runs crash. Humans retry by closing the PR and re-adding the label.

The same preflight rejects non-conventional issue titles before model spend. Humans can resolve any issue after renaming it to `type(scope): summary`.

### Context prefetch (read-only model job)

- The issue: title, body, all comments (the brief).
- Prior attempts: closed PRs with head `agent-issue-{N}` plus their review comments and review threads, so attempt N+1 learns why attempt N was rejected. The deterministic branch name is the lookup key; no other linkage bookkeeping exists.

### Sandbox and mandate

`OPENCODE_PERMISSION`: `edit: allow`, `bash: allow` (unrestricted), `external_directory: deny`, `question: deny`, `todowrite: deny`. No GitHub token. The command instructs the agent to:

- Implement exactly what the issue describes; respect its Out of scope fence. If the issue is wrong or already fixed, say so in the final message and make no changes (the empty-diff check then fails the run with that explanation in the log, and the failure comment tells the human to close the issue if they agree).
- Follow AGENTS.md conventions (injected explicitly; see section 8).
- **Fix-until-green locally, inside this single invocation**: run `bun typecheck` and the relevant package test suites for every touched package (from package directories, never root) and iterate until they pass. CI is watched afterward, but there are no CI-driven fix rounds — local green is the agent's job.
- Commit with conventional-commit messages under its own name; leave a clean worktree. The model job enforces cleanliness before creating the Git bundle, so uncommitted edits cannot disappear between runners.

### Publish (trusted steps)

1. **Basics**: non-empty committed diff against the base; clean worktree; no CI-skip directives; no changes to `.github/workflows/**`, `.github/actions/**`, `.opencode/**`, OpenCode config, `script/translate-app.ts`, or tracked instruction files. The explicit trusted-input block prevents a resolver PR from changing code that `pr-brief` would execute with reviewer credentials; the App's missing Workflows permission remains a second backstop for workflow files.
2. Recheck issue and claim state, observe the current remote branch, then push `agent-issue-{N}` with `--force-with-lease`. This makes retries idempotent without overwriting an unexpected concurrent update.
3. Open a **draft** PR targeting the default branch: title = issue title (already conventional), body = short summary + `Closes #{N}` + attribution footer (model, variant, OpenCode version, run URL) + hidden metadata comment, mirroring the review footer style.
4. **Watch checks**: poll GitHub's full `statusCheckRollup` and require two stable terminal snapshots with no failures. Recheck the head SHA before and after `gh pr ready`; if it changes during the transition, return the PR to draft. The `ready_for_review` event then fires the existing `pr-review` (full REVIEW_MODELS matrix) and `pr-brief` automations. If no checks appear within a two-minute grace period, flip ready anyway.
5. **Red path**: any failing check, or the watch running out of job time -> the draft persists as an inspectable artifact, the run goes red, and a comment on the issue links the draft and names the failing checks. The guard now blocks re-labeling until a human closes the draft (or fixes it up and marks it ready manually — trivial-failure rescue is a feature).

Merged PRs auto-close the issue through `Closes #{N}`.

## 8. Reusable workflows and run environment

Each maintenance path has a narrow reusable interface. `_agent-scan.yml` accepts `scope`; `_agent-resolve.yml` accepts `issue`; both accept `model`, `variant`, `app-client-id`, `opencode-version`, and `timeout-minutes`, plus the same App and provider secrets. Jobs:

1. **Resolver preflight** validates the invocation and performs the issue/claim guard. This job may use an App write token but runs no model code. Scanner model execution starts only after its caller's read-only queue gate.
2. **Run** checks out `${{ github.workflow_sha }}` with `persist-credentials: false` using only the caller's read-only `GITHUB_TOKEN`, prefetches context, and calls `setup-opencode`. The setup action validates both the selected model credential and optional OpenAI web-search credential against the same lease rules before merging auth. The command runs with the selected permission profile, injected tracked instructions, trusted command, provider plugin, and web-search plugin. It extracts final text and uploads an untrusted result artifact; resolver artifacts include an incremental Git bundle rooted at the trusted base.
3. **Scan publish** starts on a fresh runner, downloads the text artifact, and mints an issues-write-only App token. It rechecks the queue and exact-title duplicates before creating one issue.
4. **Resolver publish** starts on a different fresh runner, downloads the bundle artifact, and mints a checks-read plus contents/issues/PR-write token. It freshly checks out the trusted base, restores the bundle, verifies ancestry and a non-empty diff, checks both sides of renames with `--no-renames`, rejects protected paths and CI-skip directives, and rechecks issue/claim state before pushing. Both publishers use the resolved CLI version output from the model job; neither duplicates the setup pin.
5. Separate failure-reporting paths comment on resolver issues when model execution or trusted publication fails.

Caller workflows grant only what their own jobs use (`contents: read`, plus `issues: read` for the scan gate); all writes go through App tokens, which do not draw from `GITHUB_TOKEN` scopes.

## 9. Operations

```sh
# On-demand scan (optionally forcing a category).
gh workflow run agent-scan.yml -f scope=security

# Resolve a specific issue without labeling.
gh workflow run agent-resolve.yml -f issue=123

# Pause either agent.
gh variable set SCAN_MODEL --body 'off'
gh variable set RESOLVE_MODEL --body 'off'
```

- **Veto a finding**: close the issue as not planned. The scanner will not re-file it for 90 days.
- **Retry a resolve**: close the draft/rejected PR, then remove and re-add `agent-resolve`.
- **Credential freshness**: the lease check applies at whatever hour the cron fires. The scan run at 22:17 UTC needs its provider credential valid for 50+ minutes at that time; resolve runs need 70+ minutes at label time. An expired OAuth publication turns scheduled runs red until republished — that is the intended loud failure, relying on GitHub's normal workflow-failure notifications, with no extra alerting.
- **Queue hygiene**: the gate pauses scanning at 10 open `agent-task` issues. A paused scanner is a signal to drain (label or close), not a malfunction.

## 10. Decision record

Interview decisions and the reasoning that must survive refactors:

| Decision                                                         | Rationale                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate-runner trusted publishing                               | The model never shares a runner with a repository write token or App private key; the fresh publisher validates an untrusted artifact                     |
| Unrestricted bash, both agents                                   | Verification power; allowlists rejected as security theater once `bun install` runs arbitrary trusted code; short-lease credential is the real mitigation |
| Label-triggered resolver, no resolver cron                       | Human opt-in per issue; dissolves FIFO selection, claim labels, attempt caps, and poisoned-queue-head machinery                                           |
| Exactly one issue per scan run                                   | Forces prioritization quality over volume; paired with the queue gate for backpressure                                                                    |
| Draft-first PR, CI watch, ready on green                         | Reuses existing CI as the publish gate instead of duplicating toolchain logic; protects review budget (reviews fire only at `ready_for_review`)           |
| Local fix-until-green in one invocation, no CI-driven fix rounds | Simplicity; avoids multi-invocation orchestration and Actions-log App permissions                                                                         |
| Red path keeps the draft                                         | Failed attempts are inspectable and rescuable; cleanup is an explicit human decision                                                                      |
| Dedicated Hena Agent App, no Workflows permission                | Stable attribution; GitHub mechanically blocks CI self-modification                                                                                       |
| `setup-opencode` extraction + separate agent workflows           | Review path is `pull_request_target`-sensitive; scan and resolve keep explicit shapes without mode flags in shared files                                  |
| Loose issue template, no publish-step parsing                    | Trust the model's writeup; title/body split is the only mechanical contract                                                                               |
| Deterministic `agent-issue-{N}` branch                           | Doubles as the claim key and prior-attempt lookup; force-with-lease makes retries idempotent without blind overwrites                                     |
