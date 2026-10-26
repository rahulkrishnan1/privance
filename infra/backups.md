# Encrypted backups and restore verification

Use this guide to enable restic backups to Backblaze B2, inspect failures, or verify a restore. Start from the [deployment quickstart](README.md); run commands on the host from the directory containing `compose.prod.yaml`. Backups are optional, but a deployment without a tested backup has no demonstrated recovery path.

## Enable backups

### 1. Create the B2 bucket and keys

In the [Backblaze console](https://www.backblaze.com/):

1. Create a private bucket named `<your-bucket-name>`, with Default Encryption disabled (restic encrypts before upload), Object Lock disabled, and lifecycle “Keep all versions”.
2. Create a `privance-restic-prod` application key scoped to that bucket, Read and Write, with “Allow List All Bucket Names” unchecked. Save `keyID` and `applicationKey` in your password manager; the application key is shown once.
3. Create a separate `privance-restic-restore-readonly` key for recovery from another machine, so that machine cannot alter/delete snapshots. The in-place drill below uses the host's existing read-write credentials.

### 2. Store configuration and the repository password

Use the [restic environment template](env.d.example/restic.env) as the configuration reference. For a host without a checkout:

```sh
tee /etc/privance/env.d/restic.env >/dev/null <<'EOF'
B2_ACCOUNT_ID=<keyID from privance-restic-prod>
B2_ACCOUNT_KEY=<applicationKey from privance-restic-prod>
RESTIC_REPOSITORY=b2:<your-bucket-name>:/restic
RESTIC_PASSWORD_FILE=/run/secrets/restic_password
EOF
chmod 600 /etc/privance/env.d/restic.env
```

For a **new repository only**, create a password without replacing an existing one:

```sh
if [ ! -e /etc/privance/env.d/restic_password ]; then
  (umask 077; openssl rand -base64 48 > /etc/privance/env.d/restic_password)
fi
chmod 600 /etc/privance/env.d/restic_password
```

**Loss of this password makes every snapshot permanently unrecoverable.** Transfer it to your password manager using a secure file-import workflow, without printing it into terminal/session logs. Confirm the recovery copy is available independently of the host before proceeding. Keep the secrets directory mode 700 and both files mode 600.

### 3. Initialize the repository

Run once; the scheduler never calls `init`:

```sh
RESTIC_DR="docker run --rm --env-file /etc/privance/env.d/restic.env -v /etc/privance/env.d/restic_password:/run/secrets/restic_password:ro restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76"
$RESTIC_DR init
$RESTIC_DR snapshots
```

Complete when `init` reports the repository was created and `snapshots` exits 0 with an empty list. For an existing repository, skip `init` and verify access with `snapshots`; an “already exists” error is not a reason to replace its password.

### 4. Start and verify the scheduler

Add `COMPOSE_PROFILES=backups` to the deploy `.env`, then:

```sh
docker compose -f compose.prod.yaml up -d restic-runner
docker compose -f compose.prod.yaml ps restic-runner
docker compose -f compose.prod.yaml run --rm restic-runner /usr/local/bin/backup.sh
```

Expect the scheduler running `crond -f -l 8`, the on-demand backup to exit 0 with `backup succeeded`, and a new snapshot visible with:

```sh
docker compose -f compose.prod.yaml run --rm restic-runner restic snapshots --tag db --tag nightly --latest 1
```

The [crontab](restic-runner/crontab) owns the UTC schedule; [backup.sh](restic-runner/backup.sh) owns retention, and [check.sh](restic-runner/check.sh) performs structural checks. Complete setup with the restore drill below.

## Inspect backup failures

Check logs after setup and regularly thereafter:

```sh
docker compose -f compose.prod.yaml logs --tail=40 restic-runner
```

| Signal | Action / completion criterion |
|---|---|
| `backup succeeded` + `nightly run complete` | Confirm the expected snapshot exists |
| `forget+prune` non-zero | Backup may still be valid; investigate retention failure separately |
| `BACKUP FAILED with exit code N` | Read the failure, check B2 credentials/quota and Postgres health, then rerun successfully |
| `RESTIC CHECK FAILED` | Rerun `/usr/local/bin/check.sh` and investigate before trusting the repository |
| No entries at the scheduled time | Check scheduler/container health; restart `restic-runner` if wedged and verify a subsequent run |

Do not enable shell tracing: it can expose database and repository credentials.

## Restore drill

Run after initial setup and at least quarterly. This verifies a **new maintenance-window snapshot** against exact table counts, in a separate database. It does not restore production or prove every field's contents. Existing snapshots without a matching baseline can be tested for successful restoration, but not claimed to match current production counts.

**Preconditions:** backups work, no concurrent deploy/backup is running, and a short API outage is approved. Pause all database writers, including manual jobs and migrations. Keep the same Bash session for the variables below. The Bash blocks exit on failure; reconnect if needed. If failure leaves the API stopped, restore service deliberately with `docker compose -f compose.prod.yaml start server` and investigate.

### 1. Capture a stable baseline and backup

```bash
set -euo pipefail
docker compose -f compose.prod.yaml stop server
umask 077
DRILL_DIR=$(mktemp -d)
tee "$DRILL_DIR/counts.sql" >/dev/null <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;',
              schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL
docker compose -f compose.prod.yaml exec -T postgres \
  psql -XAt -v ON_ERROR_STOP=1 -U privance -d privance \
  < "$DRILL_DIR/counts.sql" > "$DRILL_DIR/source-counts"
test -s "$DRILL_DIR/source-counts"
docker compose -f compose.prod.yaml run --rm restic-runner /usr/local/bin/backup.sh
docker compose -f compose.prod.yaml run --rm restic-runner restic snapshots --tag db --tag nightly --latest 1
```

Record the ID of the snapshot just created, checking its timestamp against the successful backup output. Use that fixed ID below, not `latest`, which could change during the drill. [`n_live_tup`](https://www.postgresql.org/docs/17/monitoring-stats.html) is an estimate; the baseline above uses actual `count(*)` results.

Once the baseline and backup both succeeded, restart the API and confirm its health via [the deployment checks](README.md#step-6-verify):

```sh
docker compose -f compose.prod.yaml start server
```

### 2. Restore only into the side database

Confirm `privance_restore_test` is disposable and not used by another drill. Create it without dropping an existing database; if it already exists, investigate rather than deleting it automatically.

```bash
set -euo pipefail
SNAPSHOT='<snapshot-id-from-step-1>'
docker compose -f compose.prod.yaml exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U privance -d postgres \
  -c 'CREATE DATABASE privance_restore_test;'
docker compose -f compose.prod.yaml run --rm -T restic-runner \
  restic dump "$SNAPSHOT" /privance.dump | \
  docker compose -f compose.prod.yaml run --rm -T restic-runner sh -eu -c '
    PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_restore \
      --exit-on-error --clean --if-exists --no-owner --no-acl \
      -h postgres -U privance -d privance_restore_test
  '
```

Both sides of the pipeline must succeed. [`--exit-on-error`](https://www.postgresql.org/docs/17/app-pgrestore.html) stops on SQL failures; `pipefail` also catches a failed restic download.

### 3. Compare and clean up

```bash
set -euo pipefail
docker compose -f compose.prod.yaml exec -T postgres \
  psql -XAt -v ON_ERROR_STOP=1 -U privance -d privance_restore_test \
  < "$DRILL_DIR/counts.sql" > "$DRILL_DIR/restored-counts"
test -s "$DRILL_DIR/restored-counts"
diff -u "$DRILL_DIR/source-counts" "$DRILL_DIR/restored-counts"
```

Complete only when restore and queries exit 0, the baseline is non-empty, and `diff` exits 0 with no output. Production may have changed after restart; compare against the recorded baseline, not live production. On failure, retain the side database and counts for diagnosis and record the drill as failed.

After a successful comparison:

```sh
docker compose -f compose.prod.yaml exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U privance -d postgres \
  -c 'DROP DATABASE privance_restore_test;'
rm -r "$DRILL_DIR"
```

Record the snapshot ID, restore result, comparison result, and cleanup result. Keep repository passwords and decrypted user data out of that record.
