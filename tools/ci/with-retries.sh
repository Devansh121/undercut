#!/usr/bin/env bash
# Runs a command up to ATTEMPTS times, each bounded by ATTEMPT_TIMEOUT seconds, with exponential
# backoff between attempts (BACKOFF, 2*BACKOFF, ...). For CI steps that download from a mirror or
# a CDN: a stalled connection costs one attempt, not the job's whole time budget.
#
#   tools/ci/with-retries.sh npx playwright install-deps webkit
#
# `timeout` signals the whole process group, so `npx` -> `node` -> `sudo apt-get` all stop
# (sudo relays the signal to apt-get, which releases the dpkg lock before the next attempt).
set -uo pipefail

attempts=${ATTEMPTS:-3}
per_attempt=${ATTEMPT_TIMEOUT:-90}
backoff=${BACKOFF:-10}

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt++)); do
  echo "::group::Attempt $attempt of $attempts (limit ${per_attempt} s): $*"
  start=$SECONDS
  timeout --kill-after=10 "$per_attempt" "$@"
  status=$?
  echo "::endgroup::"
  elapsed=$((SECONDS - start))
  if [ "$status" -eq 0 ]; then
    echo "Succeeded on attempt $attempt of $attempts in ${elapsed} s."
    exit 0
  fi
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    reason="timed out after ${elapsed} s"
  else
    reason="exited with status $status after ${elapsed} s"
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    wait_s=$((backoff * (1 << (attempt - 1))))
    echo "::warning::Attempt $attempt of $attempts $reason; retrying in ${wait_s} s: $*"
    sleep "$wait_s"
  else
    echo "::error::Attempt $attempt of $attempts $reason; giving up: $*"
  fi
done
exit 1
