#!/bin/sh
# Weekly restic integrity check: structural verification only, no data-block
# reads. Runs against the B2 repo via the env_file binding on the restic-runner
# container.
set -eu

# IMPORTANT: do NOT enable `set -x`. Tracing would leak credentials.

ts() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '[%s] restic-runner: %s\n' "$(ts)" "$*" 1>&2
}

log "starting weekly restic check (structural verification only)"

set +e
restic check
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  log "restic check succeeded"
  exit 0
fi

log "RESTIC CHECK FAILED with exit code $rc"
exit "$rc"
