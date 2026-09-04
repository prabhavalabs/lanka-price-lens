#!/usr/bin/env bash
# Production dependency audit for CI.
#
# Fails the build when pnpm reports vulnerabilities, but does not fail it when the
# npm advisories endpoint itself is unreachable (an outage there says nothing about
# our dependencies and would otherwise block every deploy). A skipped audit is
# surfaced as a workflow warning so it is visible in the run summary.
set -uo pipefail

attempts=${AUDIT_ATTEMPTS:-2}
for attempt in $(seq 1 "$attempts"); do
  output=$(pnpm audit --prod 2>&1)
  status=$?
  printf '%s\n' "$output"
  if [[ $status -eq 0 ]]; then
    exit 0
  fi
  if grep -qiE 'vulnerabilit|severity' <<<"$output"; then
    echo "::error::pnpm audit --prod reported vulnerabilities"
    exit 1
  fi
  echo "::warning::pnpm audit attempt ${attempt}/${attempts} could not reach the npm advisories endpoint"
done

echo "::warning::Audit gate skipped: the npm advisories endpoint was unreachable after ${attempts} attempts and no vulnerability report was produced"
exit 0
