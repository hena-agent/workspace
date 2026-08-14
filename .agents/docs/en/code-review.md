# Reviewer Model Flag

Specification for selecting the model used by the automated PR reviewer at run time, from a repository Actions variable rather than a workflow edit.

Status: implemented and locally validated. §12 lists the remaining live-run validation items.

Applies to: `.github/workflows/pr-review.yml`, `.github/workflows/pr-brief.yml`, `.github/workflows/_opencode.yml`, `.github/actions/run-opencode/action.yml`, and a new `.github/workflows/_review-model.yml`.

---

## 1. Scope and principles

### 1.1 Purpose

Today the reviewer's model is a literal in two workflow files. `pr-review.yml` pins `anthropic/claude-sonnet-5` with `variant: max`, and `pr-brief.yml` pins the same pair. Changing either requires a pull request, review, and merge, so the model cannot be changed from a phone, cannot be changed during an incident, and cannot be changed without a merge to `develop`.

This specification introduces a repository Actions variable, `REVIEWER_MODEL`, that both workflows read on every run. Setting it takes effect on the next pull request event with no commit. It also doubles as a repo-wide kill switch, which matters because `retry-revoked-oauth.yml` exists precisely because the shared Anthropic OAuth lease dies unpredictably and today the only way to silence the reviewer during that outage is a workflow edit.

### 1.2 Principles

- **One control surface.** A single variable answers "what will run right now". There is no per-PR override and no second precedence layer.
- **Never lie about what ran.** The effective model appears in the job name, and every layer reports only what it can verify.
- **Fail closed, loudly.** An unusable configuration produces a red check and an error naming the exact command that fixes it. It never silently falls back to a different model.
- **Credential routing is code.** Which private key and which provider credential a model receives is decided by a map in a workflow file, not by runtime data.
- **The reviewer is advisory.** It is not a merge gate, which is what makes a kill switch safe.

### 1.3 Non-goals

- Running more than one reviewer model per PR
- Per-PR, per-branch, or per-author model selection
- Making the review prompt, the review skill, or the ≥150-line brief threshold configurable
- Making `timeout-minutes` configurable
- Enabling reviews on pull requests from forks

---

## 2. Decision summary

| Area | Decision |
| --- | --- |
| Flag storage | Repository Actions variable, read on every run |
| Variable names | `REVIEWER_MODEL`, `REVIEWER_OPENCODE_VERSION` |
| Value grammar | `provider/model[@variant]`, or the sentinel `off` |
| Variant delimiter | `@`, not a third `/` segment |
| Unset or empty | Falls back to the default declared in `_review-model.yml` |
| Model default | `anthropic/claude-sonnet-5@max`, matching current behavior exactly |
| Variant omitted | Falls back to the provider map's `default_variant` |
| Kill switch | `REVIEWER_MODEL=off` disables both `pr-review` and `pr-brief` |
| Scope | One variable governs both the review and the brief |
| Resolution site | New `_review-model.yml` reusable workflow with `workflow_call` outputs |
| Provider map | Inline JSON literal inside `_review-model.yml` |
| Credential names | `HENA_REVIEWER_*` serves Anthropic and `opencode-go`; `GPT_REVIEWER_*` serves OpenAI |
| Unregistered provider | Hard failure in the resolver, naming the secrets to create |
| Model validation | Runtime pre-flight against `opencode models <provider>` inside `run-opencode` |
| Invalid value | Hard failure. No fallback to the default model under any condition |
| CLI version | `REVIEWER_OPENCODE_VERSION` overrides the `1.18.18` pin in `run-opencode/action.yml` |
| Timeout | Fixed at 30 minutes, not flaggable |
| Eligibility gates | `off`, fork PRs, Dependabot, and `[skip ci]` all resolve to `enabled=false` in the resolver |
| Fork PRs | Resolve to disabled and skip, instead of hard-failing on an empty secret |
| Disabled runs | Jobs skip; no placeholder check is emitted |
| Branch protection | Reviewer checks must not be required status checks |
| Provenance | Job name carries `provider/model@variant`; run summary carries the resolved values and their source |
| Reruns | `gh run rerun --failed` reuses attempt 1's resolution; this is intended |
| Per-PR override | None |
| `gpt-review` job | Deleted; the flag supersedes it |
| Dry run | None. Verification is a scratch PR |
| Documentation | English only, in this file |

---

## 3. Configuration surface

### 3.1 Variables

Both are repository-level Actions variables. Both are optional. Neither is a secret; their values appear in logs and in job names.

| Variable | Purpose | Default when unset |
| --- | --- | --- |
| `REVIEWER_MODEL` | Model, variant, and kill switch for both reviewer workflows | `anthropic/claude-sonnet-5@max`, declared in `_review-model.yml` |
| `REVIEWER_OPENCODE_VERSION` | Overrides the pinned opencode CLI version | The pin in `.github/actions/run-opencode/action.yml` |

`REVIEWER_OPENCODE_VERSION` exists because the pinned CLI embeds a models.dev snapshot at build time, so a model released after that build is not in the catalog and the pre-flight rejects it. Without this variable the flag would stop being self-service in exactly the case it is most wanted: a model that just shipped. The cost is real and accepted in §11 — an unreviewed CLI bump changes agent behavior, tool permissions, and auto-commit semantics repo-wide, not just the model list.

### 3.2 Value grammar

`REVIEWER_MODEL` is one of:

- The sentinel `off`, compared case-insensitively after trimming.
- `provider/model`
- `provider/model@variant`

Leading and trailing whitespace is trimmed before any other processing, because mobile keyboards append spaces and autocapitalize. A value that is empty or whitespace-only after trimming is treated as unset.

The value is parsed as: `provider` is everything before the first `/`; `variant` is everything after the last `@` when an `@` is present; `model` is what remains between them.

The whole value must match `^[a-z0-9][a-z0-9-]*/[A-Za-z0-9._:/-]+(@[a-z0-9-]+)?$` before it is used anywhere. This is a strict allowlist, applied before the value is interpolated into a job name, an output, or a shell environment, and it is the only defense against a variable that contains shell metacharacters.

The delimiter is `@` and not a third `/` segment because `packages/hena/src/cli/cmd/run.ts:33-36` parses a model reference as first-segment provider plus `rest.join("/")` model id. Slash-bearing model ids such as `openrouter/anthropic/claude-sonnet-4` are therefore legitimate, and a `/`-delimited variant would misparse them as model `anthropic` with variant `claude-sonnet-4`. One consequence: `@` cannot appear inside a model id.

Examples:

| Value | Resolves to |
| --- | --- |
| unset | `anthropic` / `claude-sonnet-5` / `max` |
| `anthropic/claude-opus-5@max` | `anthropic` / `claude-opus-5` / `max` |
| `anthropic/claude-opus-5` | `anthropic` / `claude-opus-5` / `max` (provider default) |
| `openrouter/anthropic/claude-sonnet-4@high` | `openrouter` / `anthropic/claude-sonnet-4` / `high` |
| `off` | disabled |
| `anthropic/claude-opus-5/max` | rejected; model `claude-opus-5/max` is not in the catalog |

### 3.3 Provider map

The map is a JSON literal in a `run:` step of `_review-model.yml`. Its keys are provider ids; the provider parsed from the flag selects one entry.

```json
{
  "anthropic": {
    "auth_secret": "OPENCODE_AUTH_JSON",
    "client_id_var": "HENA_REVIEWER_CLIENT_ID",
    "private_key_secret": "HENA_REVIEWER_PRIVATE_KEY",
    "default_variant": "max"
  },
  "openai": {
    "auth_secret": "OPENAI_OPENCODE_AUTH_JSON",
    "client_id_var": "GPT_REVIEWER_CLIENT_ID",
    "private_key_secret": "GPT_REVIEWER_PRIVATE_KEY",
    "default_variant": "xhigh"
  },
  "opencode-go": {
    "auth_secret": "OPENCODE_GO_AUTH_JSON",
    "client_id_var": "HENA_REVIEWER_CLIENT_ID",
    "private_key_secret": "HENA_REVIEWER_PRIVATE_KEY",
    "default_variant": "max"
  }
}
```

The map holds secret and variable *names*, never values. The resolver never sees a secret.

The former Claude App was renamed to the provider-neutral Hena Reviewer. `HENA_REVIEWER_CLIENT_ID` and `HENA_REVIEWER_PRIVATE_KEY` therefore serve both Anthropic and `opencode-go`, while OpenAI keeps the existing dedicated GPT Reviewer identity. The legacy `CLAUDE_REVIEWER_*` credentials remain registered until the workflow change reaches `develop`, because the currently shipped workflow still references them; they are not part of this map.

The scheduled publisher at `~/.local/bin/hena-sync-opencode-auth.sh` emits three isolated repository secrets from the local `auth.json`: Anthropic OAuth, OpenAI OAuth, and the `opencode-go` API key. OAuth refresh tokens are replaced with `ci-refresh-disabled`; API credentials are copied without transformation. Every published JSON object contains exactly one provider. `hena-opencode-token-refresh` maintains Anthropic, and `hena-opencode-openai-token-refresh` maintains OpenAI; both gate rotation on the consuming workflows being idle and immediately invoke the publisher after rotation.

Registering a second provider is one map entry plus creating the three named credentials. It is not a code change to any other file. This is what deletes the `gpt-review` job in `pr-review.yml`, whose `if: ${{ false }}` and re-enable comment describe exactly this procedure by hand.

`default_variant` lives here rather than being a single global constant because variant vocabulary is provider-specific — Anthropic accepts `high` and `max`, OpenAI accepts `none` through `xhigh`, Google accepts `low` and `high` — and `packages/core/src/session/runner/model.ts:104-126` raises `VariantUnavailableError` for an explicit variant the model does not declare. A global default would be invalid for the second provider registered.

---

## 4. Resolution

### 4.1 `_review-model.yml`

A `workflow_call` reusable workflow with a single job. It takes no inputs; it reads `github.event` from the caller. It requires no secrets, performs no `actions/checkout`, and declares `permissions: {}`. Because it never checks out, no code or configuration from the pull request executes in the job that selects credentials.

It is valid only for `pull_request` events. Called from any other event, `github.event.pull_request` is null and the fork check resolves to disabled.

Outputs:

| Output | Value |
| --- | --- |
| `enabled` | `"true"` or `"false"` |
| `reason` | Empty when enabled; otherwise `off`, `fork`, `dependabot`, or `skip-ci` |
| `provider` | Parsed provider id |
| `model` | Full `provider/model` reference passed to `_opencode.yml` |
| `variant` | Resolved variant |
| `label` | `provider/model@variant`, for job names |
| `auth_secret` | Name of the auth secret for this provider |
| `client_id_var` | Name of the App client id variable for this provider |
| `private_key_secret` | Name of the App private key secret for this provider |
| `opencode_version` | The requested override, or empty string when unset |

When `enabled` is `"false"`, the remaining outputs are unspecified and must not be consumed.

### 4.2 Eligibility

`enabled` is `"false"` when any of the following holds, evaluated in this order so that `reason` is deterministic:

1. `off` — the trimmed, lowercased value of `REVIEWER_MODEL` is `off`.
2. `fork` — `github.event.pull_request.head.repo.full_name != github.repository`.
3. `dependabot` — `github.actor` is `dependabot[bot]`, whose pull requests do not receive repository secrets even when the head repository matches the base.
4. `skip-ci` — `github.event.pull_request.title` contains `[skip ci]`.

All four are reviewer-global, so they belong in one place. Consolidating them means "why did no review appear" has exactly one answer and one log line. `pr-brief.yml` keeps only the gates that are genuinely its own: the draft rule, the `pr-brief` label rule, and the ≥150-line threshold. The independent `[skip ci]` checks in `test.yml`, `typecheck.yml`, `knip.yml`, and `storybook.yml` are untouched; they are different subsystems that happen to share a convention.

Moving the fork check here also changes external-contributor experience. Today a fork PR reaches `run-opencode/action.yml:33-36` and hard-fails on the empty secret, so a first-time contributor's first signal is a red X they cannot fix. It now skips.

### 4.3 Validation performed by the resolver

The resolver fails the job, with `::error::` and a non-zero exit, when:

- The trimmed value is neither `off` nor a match for the grammar in §3.2.
- The parsed provider has no entry in the provider map. The error lists the registered providers and the three credential names that a new provider requires.
- The variable named by `client_id_var` is unset or empty. The resolver reads this through `toJSON(vars)` and a `jq` presence check, because expression indexing cannot use a shell-computed key. This catches a provider that is present in the map but whose credentials were never created.
- `REVIEWER_OPENCODE_VERSION` is set and does not match `^[0-9]+\.[0-9]+\.[0-9]+$`.

The resolver cannot check secret presence, because it receives no secrets. `OPENCODE_AUTH_JSON` emptiness is already caught in `run-opencode`, and an empty App private key fails `actions/create-github-app-token`.

The resolver cannot check that the model exists or that the variant is available. Both require the CLI, so both belong to §5.3.

### 4.4 Credential selection in the caller

The caller consumes the name outputs and dereferences them itself:

```yaml
with:
  app-client-id: ${{ vars[needs.resolve.outputs.client_id_var] }}
secrets:
  app-private-key: ${{ secrets[needs.resolve.outputs.private_key_secret] }}
  opencode-auth-json: ${{ secrets[needs.resolve.outputs.auth_secret] }}
```

This is mechanically supported and is not a workaround. Per the contexts reference, `jobs.<job_id>.with.<with_id>` admits `needs` and `vars`, `jobs.<job_id>.secrets.<secrets_id>` admits `needs`, `vars`, and `secrets`, and `jobs.<job_id>.name` admits `needs`. Doing the dereference in the caller is what lets `_opencode.yml` keep its explicit two-secret contract instead of taking `secrets: inherit`, which would hand it every secret in the repository.

---

## 5. Execution

### 5.1 `pr-review.yml`

Three changes. The `gpt-review` job is deleted. A `resolve` job calls `_review-model.yml`. The remaining job is renamed from `claude-review` to `review`, because the identity is no longer necessarily Claude, and gains a dynamic name:

```yaml
jobs:
  resolve:
    uses: ./.github/workflows/_review-model.yml

  review:
    needs: resolve
    if: needs.resolve.outputs.enabled == 'true'
    name: review (${{ needs.resolve.outputs.label }})
    uses: ./.github/workflows/_opencode.yml
```

The prompt is unchanged. `permissions` and `concurrency` are unchanged.

### 5.2 `pr-brief.yml`

`resolve` is added ahead of the existing `gate` job, and `gate` becomes `needs: resolve` with `if: needs.resolve.outputs.enabled == 'true'`. The chain is sequential rather than parallel: the extra ~15 seconds is irrelevant against a 4–10 minute run, and one linear order is easier to reason about than two independent gates joined at the end.

`gate`'s condition drops the `[skip ci]` and fork clauses, which are now the resolver's. The `brief` job gains the same dynamic name treatment.

### 5.3 `_opencode.yml` and `run-opencode`

`_opencode.yml` gains one additive optional input, `opencode-version` (string, default `""`), passed straight through. `model` and `variant` remain required. Nothing else changes.

`.github/actions/run-opencode/action.yml` changes in three places.

**Optional `opencode-version` input.** The pin step resolves the effective version: the input when non-empty, otherwise the constant already in the file. The constant stays here, beside the comment that explains why it exists — the models.dev snapshot, the cache key, and the unenforced pairing with `model:`. The step validates the shape again, since the action is reachable independently of the resolver.

**Pre-flight catalog check.** A new step after `Add opencode to PATH` and before `Run opencode`:

- Run `opencode models "$PROVIDER" --verbose`. A non-zero exit means the provider is not configured or not authenticated; fail with an error naming the provider.
- Exact-match `$MODEL` against the output lines. A miss fails with an error naming the model, the effective CLI version, and both remedies: correct `REVIEWER_MODEL`, or raise `REVIEWER_OPENCODE_VERSION`.
- Pass the verbose output to the canonical, unit-tested `modelVariants()` parser in `script/translate-app.ts`, then require its result to contain the requested variant. A miss fails before provider execution and lists the variants the pinned CLI exposes for that model. Do not maintain a second parser for the CLI's text format in the action.

The check runs after the auth restore because `Provider.list()` enumerates configured providers. It validates against the binary that is about to run, which is why no allowlist of vetted model ids is maintained anywhere: bumping the pin needs no corresponding list edit.

Presence in the catalog does not prove the model is undegraded. The action's existing comment records that a model whose id shape the build does not recognize silently loses adaptive thinking. The pre-flight cannot see that. See §12 item 1.

**Credential type validation.** The auth restore keeps the exactly-one-provider invariant. OAuth records require a non-empty access token, the inert refresh sentinel, an integer expiry, and 40 minutes of remaining lease at the default timeout. API records require a non-empty key and have no lease check. Other credential types fail closed.

**Run summary.** The step writes the effective CLI version and its source to `$GITHUB_STEP_SUMMARY`.

---

## 6. Failure policy

Every failure is a hard failure. There is no path on which a review runs with a model other than the one the flag names. A feature-flag-style fallback to the default was rejected because a broken flag would then sit unnoticed while producing reviews that appear to come from the configured model.

| Condition | Detected in | Result |
| --- | --- | --- |
| Value fails the grammar | resolver | Job fails; error shows the value and the grammar |
| Provider not in the map | resolver | Job fails; error lists registered providers and required credential names |
| `client_id_var` unset or empty | resolver | Job fails; error names the missing variable |
| `REVIEWER_OPENCODE_VERSION` malformed | resolver | Job fails; error shows the value and the expected shape |
| Provider not authenticated | `run-opencode` pre-flight | Job fails; error names the provider |
| Model absent from the catalog | `run-opencode` pre-flight | Job fails; error names the effective CLI version and both remedies |
| `OPENCODE_AUTH_JSON` empty, malformed, or short-leased | `run-opencode` | Unchanged existing behavior |
| Variant not available for the model | `run-opencode` pre-flight | Job fails; error lists available variants |
| `off`, fork, Dependabot, or `[skip ci]` | resolver | Not a failure; jobs skip |

The blast radius is accepted: the flag is repo-global, so a bad value stops reviews for everyone until it is corrected. This is tolerable only because the reviewer is advisory (§8.3) and because recovery requires no commit.

---

## 7. Observability

The effective configuration is visible in two places, neither of which depends on the model's cooperation.

**Job name.** The calling job is named `review (anthropic/claude-opus-5@max)` from `needs.resolve.outputs.label`. This is the string the GitHub mobile app shows in the PR checks list, which is the only reviewer state readable from a phone without opening a run log.

**Run summary.** The resolver writes the resolved provider, model, and variant, whether each came from `REVIEWER_MODEL` or from the default, the `enabled` decision, and its `reason`. It also records whether a CLI version override was requested, but not the effective version — when the variable is unset the resolver does not know it. `run-opencode` writes the effective version itself. No layer reports a value it cannot verify.

Provenance is deliberately not appended to the posted review comment. `_opencode.yml` documents that the agent's final response is posted verbatim, so a footer would have to be requested in the prompt, and models drop trailing instructions. A dropped footer is indistinguishable from an unflagged run, which is worse than no footer.

---

## 8. Security and trust boundary

### 8.1 Untrusted input

`REVIEWER_MODEL` and `REVIEWER_OPENCODE_VERSION` are treated as untrusted. Both are matched against strict anchored allowlists before use, and both reach shell only through `env:` indirection, never through inline interpolation in a `run:` body. This follows the idiom already used in `pr-brief.yml` and `retry-revoked-oauth.yml`.

### 8.2 What the pull request controls

For `pull_request` events GitHub runs the workflow files from the PR's merge commit, and `uses: ./.github/workflows/...` resolves against that same commit. A pull request's own copy of `_review-model.yml`, including the provider map, therefore governs its own review. This is a pre-existing property of every workflow file and composite action in this repository, and placing the map inline neither creates nor worsens it.

It is bounded by two facts. Fork PRs now resolve to disabled and never receive credentials. Same-repo branches require write access, and an actor with write access could already edit `run-opencode/action.yml` directly. No mitigation is specified here because none available at this layer changes the residual risk. The map is inline rather than in a separate file mainly so that the resolver needs no checkout at all.

### 8.3 The reviewer is not a merge gate

`REVIEWER_MODEL=off`, a fork or Dependabot PR, and `[skip ci]` all cause the reusable-workflow call job to skip. A skipped `uses:` job never creates the inner check runs, so a required status check naming one of them would stay pending forever and the kill switch would block every merge in the repository.

Reviewer checks must not be configured as required status checks in branch protection or rulesets. This is a normative constraint, not a recommendation. It is consistent with `react-doctor.yml`, which is deliberately advisory, and with `cancel-in-progress: true`, which already makes these runs unsuitable as gates. No placeholder green job is emitted to work around it: a green check named "review" that performed no review is a misleading signal.

Renaming `claude-review` to `review` changes existing check names. Any branch protection rule that currently references `claude-review / run` must be removed as part of this change, not repointed.

---

## 9. Operator runbook

### 9.1 Setting the flag

```sh
# Change the model. Takes effect on the next pull request event.
gh variable set REVIEWER_MODEL --body 'anthropic/claude-opus-5@max'

# Omit the variant to take the provider's default (max for anthropic).
gh variable set REVIEWER_MODEL --body 'anthropic/claude-opus-5'

# Kill switch: stop all reviews and briefs repo-wide.
gh variable set REVIEWER_MODEL --body 'off'

# Return to the pinned default.
gh variable delete REVIEWER_MODEL

# Inspect current state.
gh variable list
```

For a model newer than the pinned CLI:

```sh
gh variable set REVIEWER_OPENCODE_VERSION --body '1.19.0'
gh variable delete REVIEWER_OPENCODE_VERSION
```

Without a terminal, both variables are editable at repository Settings → Secrets and variables → Actions → Variables. The GitHub mobile app has no settings editor, so this is a mobile browser task and may need "request desktop site". The mobile app also cannot dispatch workflows, which is one reason no dispatchable dry run is specified.

### 9.2 Verifying a change

There is no dry run. Set the variable, then open a scratch pull request or push to an existing one and read the check name. The check name is the confirmation: it shows exactly what resolved.

A dry-run entry point was considered and rejected. Meaningful verification requires the catalog pre-flight, which requires installing the CLI and restoring auth, so a truthful dry run is nearly a full job; and review quality still has to be judged on a real diff.

### 9.3 Recovering from a bad value

Correct the variable, then re-run. When the resolver itself failed — a bad grammar, an unregistered provider, a malformed version — `gh run rerun --failed <run-id>` re-runs the resolver and picks up the new value.

When the resolver succeeded and only the review job failed, `--failed` does not re-run the resolver and its outputs from attempt 1 are reused, so a changed model does not take effect on that rerun. This is intended, and it is why `retry-revoked-oauth.yml` is left unchanged: that workflow retries a credential rotation race, and reproducing attempt 1 exactly is the correct behavior for it. A changed model applies from the next pull request event.

### 9.4 Errors and fixes

| Error text names | Cause | Fix |
| --- | --- | --- |
| the value and the grammar | Typo, stray `/` used as a variant delimiter, or a stray character | Re-set `REVIEWER_MODEL` per §3.2 |
| an unregistered provider | Provider has no map entry | Add the entry and create its three credentials, or choose a registered provider |
| a missing client id variable | Map entry exists, credentials do not | Create the named variable and secrets |
| the model and the CLI version | Model is not in the pinned CLI's catalog | Correct the model, or set `REVIEWER_OPENCODE_VERSION` |
| the provider and its auth secret | Provider is not authenticated in the restored `auth.json` | Republish the credential for that provider |
| `ci-refresh-disabled` or remaining lease | Existing OAuth lease assertion | Ask the credential owner to refresh and republish |

---

## 10. Fixed parameters

These stay literals and are explicitly out of scope for the flag.

`timeout-minutes` remains 30. It exists to bound a hang — an unanswered `Permission.ask` blocks forever — not to bound normal work, and observed runs finish in 4–10 minutes. Making it flaggable would also move the OAuth lease bar in `run-opencode/action.yml:48`, which requires the credential to outlive the timeout by 10 minutes; raising the timeout past the published lease would fail every run with an error about credentials rather than about the timeout that was just changed.

The ≥150-line brief threshold, the review prompt, and the `thermo-nuclear-code-quality-review` skill reference are unchanged. Review policy lives in the skill, not in the workflow.

---

## 11. Accepted tradeoffs

| Decision | Cost and mitigation |
| --- | --- |
| Repo-global flag, no per-PR override | One typo stops reviews for everyone; mitigated by hard failure with an actionable error and no-commit recovery |
| Hard fail instead of fallback | Reviews stop rather than silently degrade; this is the point, and the kill switch covers deliberate downtime |
| `REVIEWER_OPENCODE_VERSION` override | An unreviewed CLI bump changes agent behavior repo-wide and is invisible in the diff; the effective version is written to every run summary |
| No dry run | The first victim of a bad value is whoever opens the next PR; the resolver fails in ~15 seconds and costs no tokens |
| Extra `resolve` job per workflow | ~15 seconds and one more entry in the checks list, against 4–10 minute runs |
| Inline provider map | A PR's own map governs its own review; pre-existing for all workflow files, and forks are excluded |
| Two App identities for three providers | DeepSeek posts as the general-purpose Hena Reviewer rather than a model-specific bot; OpenAI retains the GPT Reviewer identity |
| `@` variant delimiter | Non-obvious versus `provider/model/variant`, and `@` cannot appear in a model id; required because slash-bearing model ids are legitimate |
| One variable for review and brief | Cannot run a cheap model for briefs and an expensive one for reviews |
| Reviewer cannot be a required check | No enforcement that a review ran before merge; consistent with the reviewer already being advisory |
| Catalog pre-flight in `run-opencode` | Bad values burn a runner job before failing; no tokens are spent and the error is precise |

---

## 12. Remaining validation items

These are open questions with explicit gates, not unspecified behavior:

1. Determine whether the silent adaptive-thinking degradation described in `run-opencode/action.yml:79-86` is detectable at run time. If it is, add it to the pre-flight; if it is not, record how to recognize it from review output so the pairing can be checked by hand when the pin moves.
2. Confirm on a real run that `gh run rerun --failed` preserves the outputs of a successful reusable-workflow `resolve` job. §9.3 depends on it, and reusable-workflow call jobs are not ordinary jobs.
3. Confirm the runtime cost of `opencode models <provider> --verbose` on a cold runner, including whether it performs a models.dev network fetch. If it does, decide whether the pre-flight needs a cache or a timeout.
4. Record the first OpenAI and `opencode-go` review runs end to end, including line comments and the top-level final response under the intended App identities.
5. Re-examine the single-variable scope after the brief and the review have run under the same flag for a period. If they are repeatedly wanted at different models, revisit §2 rather than adding a precedence chain.

Any change to the value grammar, the provider map schema, the resolver's outputs, the failure policy, or the branch-protection constraint updates this document in the same change.
