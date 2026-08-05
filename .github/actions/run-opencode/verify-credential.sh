#!/usr/bin/env bash
#
# Decide whether the restored opencode credential can carry this job to
# completion, and name the reason precisely when it cannot.
#
# Why this is worth a preflight at all
# -----------------------------------
# `Auth.all()` runs every entry through `Record.filterMap` and DISCARDS whatever
# fails to decode. A malformed credential therefore raises no authentication
# error: the provider silently never registers, and the run dies with
# `Model not found: <the model that was asked for>` - an error pointing at the
# model and away from the secret. Diagnosing that from the failure alone costs
# far more than the checks below.
#
# `Auth.Info` is a DISCRIMINATED UNION of Oauth | Api | WellKnown. `type` is not
# a routing hint that may be skipped over; it selects which schema must then
# validate. Anything whose `type` matches no member is dropped whole, so a shape
# this script does not recognise is a failure, never a pass. Both times this
# check has been wrong, it was because some shape fell through to "nothing to
# verify" - the default has to be refusal.
#
# The refresh-token half exists because the Anthropic token rotates on use:
# whichever holder refreshes first wins and every other holder is left with
# `invalid_grant`, recoverable only by logging in again. A runner must never be
# able to rotate it, so the publisher swaps in an inert value and this rejects
# anything that still looks like a real token.
#
# Contract: environment in, exit status and human-readable reason out.
#   AUTH_FILE            path to the restored auth.json
#   MODEL                provider/model id; the provider half selects the entry
#   JOB_TIMEOUT_MINUTES  the calling job's cap, in whole minutes
#   OPENCODE_BIN         optional; when set, cross-check against the real decoder
#
# Exercised by verify-credential.test.sh, which is the reason this is a file
# rather than an inline `run:` block: every past round of review had to
# hand-transcribe the logic out of the YAML before it could be tested at all.
set -euo pipefail

AUTH_FILE="${AUTH_FILE:?AUTH_FILE is required}"
MODEL="${MODEL:?MODEL is required}"
JOB_TIMEOUT_MINUTES="${JOB_TIMEOUT_MINUTES:?JOB_TIMEOUT_MINUTES is required}"
OPENCODE_BIN="${OPENCODE_BIN:-}"

# Time the token must outlive the job by. Covers clock skew and the minutes
# between this check and the last request the run makes.
HEADROOM_SEC=600

# Anthropic prefixes every issued key with this. Matching on shape rather than
# on the publisher's placeholder keeps the check from decaying into noise if
# that constant changes, and asserts the property that actually matters: not
# "is this the expected placeholder" but "can this rotate the real chain".
LIVE_TOKEN_PREFIX="sk-ant-"

fail() { echo "::error::$*"; exit 1; }

# --- inputs -----------------------------------------------------------------
case "$JOB_TIMEOUT_MINUTES" in
  '' | *[!0-9]*)
    fail "job-timeout-minutes must be a whole number of minutes, got '${JOB_TIMEOUT_MINUTES}'. Fractions cannot be used in the arithmetic below and would abort this step with a raw shell error."
    ;;
esac
MIN_REMAINING_SEC=$(( JOB_TIMEOUT_MINUTES * 60 + HEADROOM_SEC ))

PROVIDER="${MODEL%%/*}"
if [ "$PROVIDER" = "$MODEL" ] || [ -z "$PROVIDER" ]; then
  fail "model '${MODEL}' is not in provider/model form, so there is no provider whose credential could be checked."
fi

[ -f "$AUTH_FILE" ] || fail "${AUTH_FILE} does not exist; the credential was never restored."

# --- classify ---------------------------------------------------------------
# One pass, one verdict. jq's own exit status decides malformed input, so a
# truncated secret cannot be mistaken for "no OAuth provider here". Its stderr
# is deliberately left visible: the parse error is the diagnosis. Only a verdict
# crosses this boundary - no credential value is ever printed.
if ! STATUS="$(
  jq -r \
    --arg p "$PROVIDER" \
    --arg live "$LIVE_TOKEN_PREFIX" \
    --argjson now "$(date +%s)" '
    def blank(f): (f | type) != "string" or f == "";

    if type != "object" then "not-object"
    else .[$p] as $e
    | if   $e == null                       then "no-entry"
      elif ($e | type) != "object"          then "entry-not-object"
      elif ($e.type | type) != "string"     then "invalid:type"

      elif $e.type == "api"                 then
             (if   ($e.key | type) != "string" then "invalid:key"
              elif $e.key == ""                then "empty:key"
              else "skip" end)

      elif $e.type == "wellknown"           then
             (if   ($e.key   | type) != "string" then "invalid:key"
              elif $e.key   == ""                then "empty:key"
              elif ($e.token | type) != "string" then "invalid:token"
              elif $e.token == ""                then "empty:token"
              else "skip" end)

      elif $e.type != "oauth"               then "unknown-type"

      elif ($e.access  | type) != "string"  then "invalid:access"
      elif $e.access  == ""                 then "empty:access"
      elif ($e.refresh | type) != "string"  then "invalid:refresh"
      elif $e.refresh == ""                 then "empty:refresh"
      elif ($e.expires | type) != "number"
        or ($e.expires | floor) != $e.expires
        or $e.expires < 0                   then "bad-expires"
      elif ($e.refresh | startswith($live)) then "live-refresh"
      else "ok:\($e.expires / 1000 - $now | floor):\($e.expires / 1000 | floor | todate)"
      end
    end
  ' "$AUTH_FILE"
)"; then
  fail "the credential is not valid JSON (see the jq error above). It is corrupt or was truncated in transit; republish it."
fi

case "$STATUS" in
  not-object)
    fail "the credential is valid JSON but not an object. It must map provider ids to credentials, as auth.json does. Republish it."
    ;;
  no-entry)
    fail "the credential has no '${PROVIDER}' entry, and it is the only credential source this job has, so the run would fail with a misleading 'Model not found: ${MODEL}'. Either it was published from a machine not logged into ${PROVIDER}, or the caller's model: no longer matches what was published."
    ;;
  entry-not-object)
    fail "the '${PROVIDER}' entry is not an object. No member of the Oauth | Api | WellKnown union can match it, so opencode discards it and the run would fail with a misleading 'Model not found: ${MODEL}'."
    ;;
  invalid:type)
    fail "the '${PROVIDER}' entry has no \`type\`, or it is not a string. \`type\` selects which credential schema applies, so without it no member of the union matches and opencode discards the entry - the run would fail with a misleading 'Model not found: ${MODEL}'."
    ;;
  unknown-type)
    fail "the '${PROVIDER}' entry has a \`type\` that is none of oauth, api or wellknown. No member of the union matches, so opencode discards it and the run would fail with a misleading 'Model not found: ${MODEL}'."
    ;;
  invalid:*)
    fail "the '${PROVIDER}' entry is missing \`${STATUS#invalid:}\`, or it is not a string. Its schema requires one, and opencode discards the whole entry when decoding fails, so the run would fail with a misleading 'Model not found: ${MODEL}'."
    ;;
  empty:*)
    fail "the '${PROVIDER}' entry has an empty \`${STATUS#empty:}\`. An empty string is schema-valid, so opencode keeps the credential and the failure surfaces later as an authentication error rather than a missing provider - but the secret is malformed either way. Republish it."
    ;;
  bad-expires)
    fail "the '${PROVIDER}' entry has a malformed \`expires\`: it must be a non-negative integer number of milliseconds. opencode discards the entry, so the run would fail with a misleading 'Model not found: ${MODEL}'."
    ;;
  live-refresh)
    fail "the '${PROVIDER}' entry carries a live refresh token. A runner able to refresh can rotate the shared credential chain, which breaks the developer machine and every other repo using it until someone logs in again. Failing this one job is the cheaper outcome. Check NEUTER_REFRESH_PROVIDERS in hena-sync-opencode-auth.sh."
    ;;
  skip)
    echo "${PROVIDER} uses a credential with no expiry; nothing time-based to verify."
    exit 0
    ;;
  ok:*)
    IFS=: read -r _ REMAINING EXPIRES_AT <<<"$STATUS"
    ;;
  *)
    fail "the credential check produced an unrecognised verdict '${STATUS}'; refusing to guess."
    ;;
esac

# The instant is reported alongside the delta because a large negative delta
# alone cannot tell a publisher that slept through a weekend from a junk field.
if [ "$REMAINING" -lt "$MIN_REMAINING_SEC" ]; then
  fail "the ${PROVIDER} access token expires at ${EXPIRES_AT} (${REMAINING}s from now), but this job may run for ${MIN_REMAINING_SEC}s. It would reach expiry mid-run and try to refresh, which it deliberately cannot do. If that instant is only hours old the publishing machine is likely asleep and will republish on its own; if it is implausible, the secret itself is wrong."
fi

# --- cross-check against the real decoder ------------------------------------
# Everything above is this script's own reading of a schema that lives in a
# separately released artifact. The two agree today; nothing would notice the
# day they stop, and a silently drifting copy is precisely the failure mode this
# script exists to prevent. So when the CLI is available, ask it: it applies the
# decoder that actually governs, and any entry it drops is one this script
# wrongly accepted. It cannot say WHICH entry - `auth list` has no machine
# readable output in 1.18.13 - which is why the classifier above still earns its
# place: it supplies the reason, this supplies the authority.
if [ -n "$OPENCODE_BIN" ]; then
  DECLARED="$(jq -r 'keys | length' "$AUTH_FILE")"

  if ! LISTING="$("$OPENCODE_BIN" auth list 2>&1)"; then
    fail "\`opencode auth list\` failed, so the credential could not be checked against the decoder that will actually read it: ${LISTING}"
  fi

  ACCEPTED="$(printf '%s\n' "$LISTING" | sed -n 's/.*[^0-9]\([0-9][0-9]*\)[[:space:]]*credentials\{0,1\}.*/\1/p' | head -1)"
  if [ -z "$ACCEPTED" ]; then
    fail "could not read a credential count out of \`opencode auth list\`. Its output format changed, and this cross-check cannot be trusted until the parsing is updated."
  fi

  if [ "$ACCEPTED" -lt "$DECLARED" ]; then
    fail "opencode accepted only ${ACCEPTED} of the ${DECLARED} credentials in the secret, so it discarded $(( DECLARED - ACCEPTED )). The checks above passed, which means this script's copy of the schema has drifted from the installed CLI's. Reconcile it against packages/hena/src/auth/index.ts at the pinned OPENCODE_VERSION."
  fi

  echo "opencode accepted all ${DECLARED} credentials in the secret."
fi

echo "${PROVIDER} credential OK: expires at ${EXPIRES_AT}, ${REMAINING}s away, at least ${MIN_REMAINING_SEC}s required."
