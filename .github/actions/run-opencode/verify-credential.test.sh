#!/usr/bin/env bash
#
# Table-driven tests for verify-credential.sh.
#
# The table is the point. Three rounds of review found this logic wrong, each
# time by hand-extracting it from a YAML `run:` block and trying shapes nobody
# had written down. Coverage that depends on someone choosing to transcribe the
# code is not coverage. Every shape ever found broken is a row here, so "did we
# miss one" is answered by reading a list instead of by review archaeology.
#
# Rows marked SCHEMA were checked against a real CLI with `opencode auth list`
# in an isolated XDG_DATA_HOME: DROPPED means the decoder discards the entry, so
# the provider never registers and the run dies with `Model not found`. Those
# are the shapes that must never pass.
#
# Usage: ./verify-credential.test.sh
#
# shellcheck disable=SC2016
# Expected-output strings quote the script's own backticks (`type`, `access`)
# so a message can be matched exactly rather than by a vague fragment. They are
# literals in single quotes, not command substitutions.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-credential.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FUTURE_MS=$(( ($(date +%s) + 7200) * 1000 ))   # 2h out: passes a 30m cap
SOON_MS=$((   ($(date +%s) + 600)  * 1000 ))   # 10m out: fails a 30m cap

PASSED=0
FAILED=0

# check <expect_exit> <expect_substring> <name> <auth-json> [model] [timeout-min]
check() {
  local want_exit="$1" want_text="$2" name="$3" body="$4"
  local model="${5:-anthropic/claude-opus-5}" timeout="${6:-30}"
  local out status

  printf '%s' "$body" > "$WORK/auth.json"

  out="$(AUTH_FILE="$WORK/auth.json" MODEL="$model" JOB_TIMEOUT_MINUTES="$timeout" \
         bash "$SCRIPT" 2>&1)"
  status=$?

  if [ "$status" != "$want_exit" ]; then
    printf 'FAIL  %-34s expected exit %s, got %s\n      %s\n' "$name" "$want_exit" "$status" "$out"
    FAILED=$(( FAILED + 1 ))
    return
  fi
  if ! printf '%s' "$out" | grep -qF -- "$want_text"; then
    printf 'FAIL  %-34s expected output containing %s\n      %s\n' "$name" "'$want_text'" "$out"
    FAILED=$(( FAILED + 1 ))
    return
  fi
  printf 'ok    %-34s\n' "$name"
  PASSED=$(( PASSED + 1 ))
}

oauth() { # oauth <access> <refresh> <expires>
  printf '{"anthropic":{"type":"oauth","access":%s,"refresh":%s,"expires":%s}}' "$1" "$2" "$3"
}

echo "── the secret itself is unusable ──"
check 1 'not valid JSON'      'truncated json'        '{"anthropic":{"type":"oauth","access":"t","expi'
check 1 'not valid JSON'      'not json at all'       'nope'
check 1 'not an object'       'array at root'         '[1,2,3]'
check 1 'not an object'       'string at root'        '"hello"'
check 1 'not an object'       'number at root'        '42'

echo "── the provider is absent ──"
check 1 "no 'anthropic' entry" 'empty object'         '{}'
check 1 "no 'mistral' entry"   'provider not present' '{"google":{"type":"api","key":"k"}}' mistral/whatever

echo "── the union discriminator (SCHEMA: all DROPPED) ──"
check 1 'no `type`'          'type absent'          "{\"anthropic\":{\"access\":\"t\",\"refresh\":\"n\",\"expires\":$FUTURE_MS}}"
check 1 'no `type`'          'type is null'         "{\"anthropic\":{\"type\":null,\"access\":\"t\",\"refresh\":\"n\",\"expires\":$FUTURE_MS}}"
check 1 'no `type`'          'type is not a string' "{\"anthropic\":{\"type\":7,\"access\":\"t\",\"refresh\":\"n\",\"expires\":$FUTURE_MS}}"
check 1 'none of oauth'        'type typo "oath"'     "{\"anthropic\":{\"type\":\"oath\",\"access\":\"t\",\"refresh\":\"n\",\"expires\":$FUTURE_MS}}"
check 1 'not an object'        'entry is a string'    '{"anthropic":"oops"}'
check 1 'not an object'        'entry is a number'    '{"anthropic":12345}'
check 1 'not an object'        'entry is an array'    '{"anthropic":[]}'

echo "── non-oauth union members (SCHEMA: incomplete ones DROPPED) ──"
check 1 'missing `key`'      'api without key'      '{"anthropic":{"type":"api"}}'
check 1 'empty `key`'        'api with empty key'   '{"anthropic":{"type":"api","key":""}}'
check 1 'missing `key`'      'wellknown bare'       '{"anthropic":{"type":"wellknown"}}'
check 1 'missing `token`'    'wellknown w/o token'  '{"anthropic":{"type":"wellknown","key":"K"}}'
check 0 'nothing time-based'   'api with key'         '{"anthropic":{"type":"api","key":"k"}}'
check 0 'nothing time-based'   'wellknown complete'   '{"anthropic":{"type":"wellknown","key":"K","token":"T"}}'
check 0 'nothing time-based'   'other provider is api' '{"google":{"type":"api","key":"k"}}' google/gemini-3-pro

echo "── oauth required fields (SCHEMA: absent DROPPED, empty KEPT) ──"
check 1 'missing `access`'   'access absent'        "{\"anthropic\":{\"type\":\"oauth\",\"refresh\":\"n\",\"expires\":$FUTURE_MS}}"
check 1 'missing `access`'   'access not a string'  "$(oauth 42 '"n"' "$FUTURE_MS")"
check 1 'empty `access`'     'access empty'         "$(oauth '""' '"n"' "$FUTURE_MS")"
check 1 'missing `refresh`'  'refresh absent'       "{\"anthropic\":{\"type\":\"oauth\",\"access\":\"t\",\"expires\":$FUTURE_MS}}"
check 1 'missing `refresh`'  'refresh not a string' "$(oauth '"t"' '[]' "$FUTURE_MS")"
check 1 'empty `refresh`'    'refresh empty'        "$(oauth '"t"' '""' "$FUTURE_MS")"

echo "── expires must be a non-negative integer ──"
check 1 'malformed `expires`' 'expires absent'      '{"anthropic":{"type":"oauth","access":"t","refresh":"n"}}'
check 1 'malformed `expires`' 'expires null'        "$(oauth '"t"' '"n"' null)"
check 1 'malformed `expires`' 'expires float'       "$(oauth '"t"' '"n"' 1785000000000.5)"
check 1 'malformed `expires`' 'expires negative'    "$(oauth '"t"' '"n"' -5)"
check 1 'malformed `expires`' 'expires a string'    "$(oauth '"t"' '"n"' "\"$FUTURE_MS\"")"
check 1 'expires at 1970'       'expires zero'        "$(oauth '"t"' '"n"' 0)"

echo "── the rotation hazard ──"
check 1 'live refresh token'   'live sk-ant token'    "$(oauth '"t"' '"sk-ant-ort01-REDACTED"' "$FUTURE_MS")"
check 0 'credential OK'        'inert placeholder'    "$(oauth '"t"' '"ci-refresh-disabled"' "$FUTURE_MS")"
check 0 'credential OK'        'any other inert value' "$(oauth '"t"' '"whatever"' "$FUTURE_MS")"

echo "── freshness is driven by the job cap ──"
check 0 'credential OK'        '2h token, 30m cap'    "$(oauth '"t"' '"n"' "$FUTURE_MS")" anthropic/claude-opus-5 30
check 1 'may run for 7800s'    '2h token, 120m cap'   "$(oauth '"t"' '"n"' "$FUTURE_MS")" anthropic/claude-opus-5 120
check 1 'from now'             '10m token, 30m cap'   "$(oauth '"t"' '"n"' "$SOON_MS")"

echo "── bad inputs to the check itself ──"
check 1 'whole number'         'fractional timeout'   "$(oauth '"t"' '"n"' "$FUTURE_MS")" anthropic/claude-opus-5 45.5
check 1 'whole number'         'non-numeric timeout'  "$(oauth '"t"' '"n"' "$FUTURE_MS")" anthropic/claude-opus-5 abc
check 1 'whole number'         'negative timeout'     "$(oauth '"t"' '"n"' "$FUTURE_MS")" anthropic/claude-opus-5 -5
check 1 'provider/model form'  'model has no slash'   "$(oauth '"t"' '"n"' "$FUTURE_MS")" claude-opus-5

echo "── cross-check against the real decoder ──"
# A stub stands in for the CLI so these stay fast and hermetic. What is under
# test is the reaction to each answer, not the CLI itself.
stub() { # stub <exit-code> <stdout>
  # shellcheck disable=SC2016  # $2 is for the stub's own runtime, not now
  printf '#!/usr/bin/env bash\ncat <<"EOF"\n%s\nEOF\nexit %s\n' "$2" "$1" > "$WORK/opencode"
  chmod +x "$WORK/opencode"
}

xcheck() { # xcheck <expect_exit> <expect_substring> <name> <auth-json>
  local want_exit="$1" want_text="$2" name="$3" body="$4" out status
  printf '%s' "$body" > "$WORK/auth.json"
  out="$(AUTH_FILE="$WORK/auth.json" MODEL=anthropic/claude-opus-5 JOB_TIMEOUT_MINUTES=30 \
         OPENCODE_BIN="$WORK/opencode" bash "$SCRIPT" 2>&1)"
  status=$?
  if [ "$status" != "$want_exit" ] || ! printf '%s' "$out" | grep -qF -- "$want_text"; then
    printf 'FAIL  %-34s exit=%s want=%s\n      %s\n' "$name" "$status" "$want_exit" "$out"
    FAILED=$(( FAILED + 1 )); return
  fi
  printf 'ok    %-34s\n' "$name"
  PASSED=$(( PASSED + 1 ))
}

ONE_ENTRY="$(oauth '"t"' '"ci-refresh-disabled"' "$FUTURE_MS")"
TWO_ENTRIES="${ONE_ENTRY%\}}"',"google":{"type":"api","key":"k"}}'

stub 0 '┌  Credentials
●  Anthropic  oauth
└  1 credential'
xcheck 0 'accepted all 1'        'cli accepts every entry'  "$ONE_ENTRY"

stub 0 '┌  Credentials
●  Anthropic  oauth
└  1 credential
●  Azure  AZURE_API_KEY
└  1 environment variable'
xcheck 1 'accepted only 1 of the 2' 'cli silently dropped one' "$TWO_ENTRIES"

stub 0 'no counts anywhere in here'
xcheck 1 'output format changed'  'count not parseable'      "$ONE_ENTRY"

stub 1 'boom'
xcheck 1 'auth list` failed'      'cli itself fails'         "$ONE_ENTRY"

echo
printf 'passed %d, failed %d\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
