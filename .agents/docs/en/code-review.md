# Review model configuration

The automated PR review and PR brief workflows select models from repository Actions variables. Review runs use a model matrix. Brief runs use one independently configured model and default to `opencode-go/ox-alpha-free@max`.

Applies to `.github/workflows/pr-review.yml`, `.github/workflows/pr-brief.yml`, `.github/workflows/_review-model.yml`, `.github/workflows/_opencode.yml`, `.github/actions/run-opencode/action.yml`, and `.opencode/command/thermo-nuclear-code-quality-review.md`.

## Variables

| Variable | Purpose | Default when unset |
| --- | --- | --- |
| `REVIEW_MODELS` | Comma-separated models that review each eligible PR in parallel | `openai/gpt-5.6-sol@high,anthropic/claude-sonnet-5@max,opencode-go/ox-alpha-free@max` |
| `BRIEF_MODEL` | The single model that creates PR briefs | `opencode-go/ox-alpha-free@max` |
| `REVIEWER_OPENCODE_VERSION` | Exact OpenCode CLI version override shared by both workflows | The pin in `.github/actions/run-opencode/action.yml` |

`REVIEW_MODELS=off` disables PR reviews without disabling briefs. `BRIEF_MODEL=off` disables briefs without disabling reviews.

All model entries require this form:

```text
provider/model@variant
```

Variants are mandatory. Whitespace around comma-separated review entries is trimmed. Empty entries and duplicate entries are rejected. The provider must be registered in `_review-model.yml`.

Examples:

```sh
gh variable set REVIEW_MODELS --body 'openai/gpt-5.6-sol@high,anthropic/claude-sonnet-5@max,opencode-go/ox-alpha-free@max'
gh variable set BRIEF_MODEL --body 'opencode-go/ox-alpha-free@max'

# Disable and restore reviews.
gh variable set REVIEW_MODELS --body 'off'
gh variable delete REVIEW_MODELS

# Disable and restore briefs.
gh variable set BRIEF_MODEL --body 'off'
gh variable delete BRIEF_MODEL
```

Deleting a variable restores its workflow default.

## Resolution

`_review-model.yml` accepts a required `configuration` input:

| Value | Variable read | Output |
| --- | --- | --- |
| `review` | `REVIEW_MODELS` | A GitHub Actions matrix with one row per model |
| `brief` | `BRIEF_MODEL` | One resolved model through the existing singular outputs |

Each matrix row contains the resolved `model`, `variant`, display `label`, provider auth secret name, GitHub App client ID variable name, and App private key secret name. It contains credential names, never credential values.

The provider map currently routes credentials as follows:

| Provider | Auth secret | App client ID variable | App private key secret |
| --- | --- | --- | --- |
| `anthropic` | `OPENCODE_AUTH_JSON` | `HENA_REVIEWER_CLIENT_ID` | `HENA_REVIEWER_PRIVATE_KEY` |
| `openai` | `OPENAI_OPENCODE_AUTH_JSON` | `GPT_REVIEWER_CLIENT_ID` | `GPT_REVIEWER_PRIVATE_KEY` |
| `opencode-go` | `OPENCODE_GO_AUTH_JSON` | `HENA_REVIEWER_CLIENT_ID` | `HENA_REVIEWER_PRIVATE_KEY` |

The resolver fails before model jobs start when it encounters malformed entries, duplicate entries, an unregistered provider, a missing App client ID variable, more than 256 review entries, or a malformed CLI version override. Model and variant availability are checked later against the installed OpenCode CLI.

Fork PRs and PRs authored by Dependabot resolve as disabled because repository credentials are unavailable. The two `off` settings are evaluated independently before those shared eligibility checks.

## Review triggers

The default-branch-owned `pr-review.yml` workflow starts reviews in three cases:

1. A non-draft pull request is opened.
2. A draft pull request is marked ready for review.
3. The `pr-review` label is added, including on a draft.

Pushes, edits, reopening, and unrelated labels do not start reviews. Draft pull requests otherwise do not start reviews. Unrelated label events use distinct concurrency groups, so they also cannot cancel an active review. To force another review, remove and add the `pr-review` label again.

The review job uses `fail-fast: false`, so one model failure does not cancel the other model rows. GitHub runs rows in parallel subject to runner availability. Per-PR concurrency still cancels an older in-flight review set when a new request arrives. Each published review starts with workflow-generated model, variant, OpenCode version, run, and commit provenance.

## Review command

Reviews invoke the project-owned `thermo-nuclear-code-quality-review` command through `pull_request_target`, so GitHub loads the caller, reusable workflow, and local composite action from the trusted default-branch workflow commit. The workflow checks out the pull request under `.opencode-review-target` without persisted credentials and treats it only as review data. Before the model can read that checkout, the workflow renders symbolic links as plain link-target files and removes project instruction filenames. The action disables project config, installs the trusted command as global OpenCode config, and injects only approved plugins and trusted instruction files. Instructions added or changed by the pull request remain visible in the diff but cannot override the command or trusted conventions.

The command runs as a delegated subtask. If that subtask completes but the final presentation turn ends on a retryable provider error, the action extracts and publishes the completed task result. Other provider and command failures remain hard failures.

## Brief behavior

`pr-brief.yml` keeps its existing size and draft gates. It resolves `BRIEF_MODEL` separately and publishes at most one brief. Changing or disabling the review matrix does not affect briefs. Unrelated label events neither resolve a brief model nor cancel an active brief.

## OpenCode version

The CLI embeds a model catalog. A new model may require a newer exact version:

```sh
gh variable set REVIEWER_OPENCODE_VERSION --body "$(gh release view --repo anomalyco/opencode --json tagName --jq '.tagName | ltrimstr("v")')"
gh variable delete REVIEWER_OPENCODE_VERSION
```

The composite action validates the override and checks that every selected model and variant exists before invoking the provider.

## Security

Repository variable values are treated as untrusted input. The resolver trims them and applies strict allowlists before placing values in job names, outputs, or shell variables. Provider routing remains an inline code-owned map. Callers dereference only the selected secret names rather than inheriting every repository secret.

Review jobs never execute pull request code. OpenCode runs inside the credential-free pull request checkout with project config disabled, edit access denied, external-directory access denied, and shell access limited to a wrapper that returns preloaded `gh pr view` and `gh pr diff` output. Fork and Dependabot pull requests remain disabled before model credentials are passed to a job.

Reviewer and brief checks are advisory and must not be required branch-protection checks. Disabled or ineligible configurations skip the model jobs instead of emitting placeholder successful checks.
