#!/bin/sh
# Streams pg_dump (custom format, uncompressed so restic can dedupe) into
# `restic backup --stdin-from-command`. Never writes the dump to disk; never
# logs secrets.
set -eu

# IMPORTANT: do NOT enable `set -x`. Tracing would leak PGPASSWORD and any
# query-string credentials to docker logs.

ts() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '[%s] restic-runner: %s\n' "$(ts)" "$*" 1>&2
}

log "starting nightly backup"

# PGPASSWORD is set only on the restic invocation below using POSIX VAR=val
# command syntax, so it lives in restic's (and pg_dump's) env, never in this
# script's process env.
PGPASS=$(cat /run/secrets/postgres_password)

set +e
PGPASSWORD="$PGPASS" restic backup \
  --stdin-from-command \
  --stdin-filename privance.dump \
  --tag db --tag nightly \
  --host privance-prod \
  -- pg_dump \
       --format=custom \
       --no-owner --no-acl \
       --clean --if-exists \
       --compress=0 \
       -h postgres -U privance privance
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  log "backup succeeded"

  # Backup exit code is authoritative; forget exit code is advisory only
  # (restic GH issue #5233: forget can return 0 even when some removals failed,
  # and a forget failure must not mask a successful backup).
  set +e
  restic forget \
    --tag db \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 6 \
    --prune
  forget_rc=$?
  set -e

  if [ "$forget_rc" -eq 0 ]; then
    log "forget+prune succeeded"
  else
    log "forget+prune returned non-zero (advisory; backup itself was OK), exit code $forget_rc"
  fi

  log "nightly run complete"
  exit 0
fi

log "BACKUP FAILED with exit code $rc"
exit "$rc"
