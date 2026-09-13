#!/usr/bin/env bash
set -euo pipefail

COMMAND=${1:?command is required}
PR=${2:?PR number is required}
case "$COMMAND" in
  pr-video | pr-video-gate) ;;
  *) echo "::error::Unsupported video command"; exit 1 ;;
esac
source "$GITHUB_WORKSPACE/.github/actions/run-opencode/prefetch-context.sh" "$PR"
unset GH_TOKEN GITHUB_TOKEN

OPENCODE_PERMISSION=$(jq -cn --arg pr "$PR" --arg command "$COMMAND" '
  {
    edit: "deny", external_directory: "deny", question: "deny", todowrite: "deny",
    task: "deny", webfetch: "deny", websearch: "deny",
    skill: {"*": "deny"},
    bash: {"*": "deny", ("gh pr view " + $pr): "allow", ("gh pr diff " + $pr): "allow"}
  } | if $command == "pr-video" then
    .skill["agent-browser"] = "allow" | .bash["agent-browser *"] = "allow" |
    .read = {"*": "allow", "*tmp/pr-video-target/*": "deny"}
  else . end
')
export OPENCODE_PERMISSION
export OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1 OPENCODE_DISABLE_PROJECT_CONFIG=1
export AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1,localhost
export AGENT_BROWSER_SESSION="pr-video-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
# Ignore any PR-authored agent-browser.json, and use a fresh local browser session.
export AGENT_BROWSER_CONFIG="$RUNNER_TEMP/pr-video-browser.json"
printf '{}\n' > "$AGENT_BROWSER_CONFIG"

if [ "$COMMAND" = pr-video-gate ]; then
  cd "$GITHUB_WORKSPACE/tmp/pr-video-target"
fi
STATUS=0
REMAINING=$(( ${PR_VIDEO_DEADLINE:-$(($(date +%s) + (JOB_TIMEOUT_MINUTES - 5) * 60))} - $(date +%s) ))
if [ "$REMAINING" -le 0 ]; then
  echo "::error::App setup exhausted the recording budget."
  exit 1
fi
timeout --signal=TERM --kill-after=30s "${REMAINING}s" \
  opencode run --command "$COMMAND" --model "$MODEL" --variant "$VARIANT" \
  --format json "$PR${MODEL_FLOWS:+ $MODEL_FLOWS}" \
  > "$RUNNER_TEMP/pr-video.ndjson" || STATUS=$?

if [ "$COMMAND" = pr-video ]; then
  # Finalize a take even when the model times out; leave time to upload evidence.
  timeout --kill-after=5s 20s agent-browser record stop >/dev/null 2>&1 || true
  timeout --kill-after=5s 20s agent-browser close >/dev/null 2>&1 || true
fi

if jq -es 'any(.[]; .type == "error")' "$RUNNER_TEMP/pr-video.ndjson" >/dev/null; then STATUS=1; fi
if [ "$STATUS" -eq 0 ]; then
  jq -jrs --arg operation final-text --arg command "$COMMAND" \
    -f "$GITHUB_WORKSPACE/.github/actions/setup-opencode/extract-result.jq" \
    "$RUNNER_TEMP/pr-video.ndjson" > "$RUNNER_TEMP/pr-video-result.md" || STATUS=1
fi
if [ "$STATUS" -ne 0 ]; then
  printf 'Recording agent did not finish (exit %s). Completed clips are included below.\n' "$STATUS" > "$RUNNER_TEMP/pr-video-result.md"
fi
if [ "$COMMAND" = pr-video-gate ]; then
  # A provider error or malformed response never schedules the paid recorder.
  if [ "$STATUS" -ne 0 ]; then : > "$RUNNER_TEMP/pr-video-result.md"; fi
  bun "$GITHUB_WORKSPACE/.github/actions/pr-video/gate.ts"
fi
