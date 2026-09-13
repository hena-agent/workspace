#!/usr/bin/env bash
# Source this before dropping GH_TOKEN. Both reviewers and browser agents receive
# the same immutable PR context through a credential-free gh wrapper.
set -euo pipefail

PR_NUMBER=${1:?pull request number is required}
if ! [[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::Expected a pull request number."
  exit 1
fi
REVIEW_CONTEXT="$RUNNER_TEMP/opencode-review-context"
install -d -m 700 "$REVIEW_CONTEXT/bin"
BASE_SHA=$(jq -r '.pull_request.base.sha' "$GITHUB_EVENT_PATH")
HEAD_SHA=$(jq -r '.pull_request.head.sha' "$GITHUB_EVENT_PATH")

gh pr view "$PR_NUMBER" > "$REVIEW_CONTEXT/view"
if ! gh pr diff "$PR_NUMBER" > "$REVIEW_CONTEXT/diff" 2> "$REVIEW_CONTEXT/diff-error"; then
  DIFF_ERROR=$(<"$REVIEW_CONTEXT/diff-error")
  if [[ "$DIFF_ERROR" != *"HTTP 406"* ]]; then
    printf '%s\n' "$DIFF_ERROR" >&2
    exit 1
  fi
  echo "::notice::GitHub could not render this PR's diff; using the local merge-base diff."
  MERGE_BASE_SHA=$(gh api "repos/$GITHUB_REPOSITORY/compare/$BASE_SHA...$HEAD_SHA" --jq '.merge_base_commit.sha')
  GIT_AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  git -c http.https://github.com/.extraheader="$GIT_AUTH_HEADER" \
    fetch --no-tags --depth=1 origin "$MERGE_BASE_SHA" "$HEAD_SHA"
  unset GIT_AUTH_HEADER
  git diff --no-ext-diff --find-renames "$MERGE_BASE_SHA" "$HEAD_SHA" > "$REVIEW_CONTEXT/diff"
fi

# These variables expand when OpenCode invokes the generated wrapper.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [ "$#" -ne 3 ] || [ "$1" != "pr" ] || [ "$3" != "$OPENCODE_REVIEW_PR" ]; then' \
  '  echo "Only the configured PR view and diff commands are available." >&2' \
  '  exit 1' \
  'fi' \
  'case "$2" in' \
  '  view) cat "$OPENCODE_REVIEW_VIEW" ;;' \
  '  diff) cat "$OPENCODE_REVIEW_DIFF" ;;' \
  '  *) echo "Only PR view and diff are available." >&2; exit 1 ;;' \
  'esac' \
  > "$REVIEW_CONTEXT/bin/gh"
chmod 700 "$REVIEW_CONTEXT/bin/gh"
export OPENCODE_REVIEW_PR="$PR_NUMBER"
export OPENCODE_REVIEW_VIEW="$REVIEW_CONTEXT/view"
export OPENCODE_REVIEW_DIFF="$REVIEW_CONTEXT/diff"
export PATH="$REVIEW_CONTEXT/bin:$PATH"
