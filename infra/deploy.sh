#!/bin/bash
# Deploy a tagged release to the production host.
# Usage: ./infra/deploy.sh <version>   e.g. ./infra/deploy.sh v0.2.0
# Run from the repo root.
#
# Requires: gh >= 2.20 (older versions report tag-triggered runs with a null
# branch, which makes the release-workflow check fail as "no run found").
#
# Required env:
#   PRIVANCE_DEPLOY_HOST  SSH alias or user@host
# Optional env:
#   PRIVANCE_DOMAIN       defaults to privance.app
#   PRIVANCE_REMOTE_DIR   defaults to ~/privance
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>  (e.g. v0.2.0)" >&2
  exit 1
fi

# Semver-shaped only: VERSION is interpolated into a remote sed expression, so
# shell- and sed-significant characters must never reach it. Matches release.yml's
# v*.*.* trigger.
if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
  echo "Error: version must look like v1.2.3 (got: $VERSION)" >&2
  exit 1
fi

if [ -z "${PRIVANCE_DEPLOY_HOST:-}" ]; then
  echo "Error: PRIVANCE_DEPLOY_HOST is not set. Export the SSH alias or user@host for the production server." >&2
  exit 1
fi

HOST="$PRIVANCE_DEPLOY_HOST"
DOMAIN="${PRIVANCE_DOMAIN:-privance.app}"
REMOTE_DIR="${PRIVANCE_REMOTE_DIR:-~/privance}"

echo "==> Verifying tag $VERSION exists on origin..."
if ! git ls-remote --exit-code --tags origin "refs/tags/$VERSION" > /dev/null 2>&1; then
  echo "Error: tag $VERSION not found on origin. Push it first: git push origin $VERSION" >&2
  exit 1
fi

echo "==> Checking release workflow status for $VERSION..."
if command -v gh > /dev/null 2>&1; then
  run_json=$(gh run list --workflow=release.yml --event push --branch "$VERSION" --json status,conclusion --limit 1 2>/dev/null || echo "[]")
  if [ "$run_json" = "[]" ]; then
    echo "Error: no release workflow run found for $VERSION. Wait for it to start (it triggers on the tag push), then re-run. Track with: gh run watch" >&2
    exit 1
  fi
  run_status=$(printf '%s' "$run_json" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  run_conclusion=$(printf '%s' "$run_json" | grep -o '"conclusion":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$run_status" != "completed" ] || [ "$run_conclusion" != "success" ]; then
    echo "Error: release workflow for $VERSION has not completed successfully (status=$run_status conclusion=$run_conclusion)." >&2
    echo "Wait for it to finish or fix it, then re-run. Track with: gh run watch" >&2
    exit 1
  fi
  echo "    Release workflow: completed / success"
else
  echo "Warning: gh not installed; skipping workflow check. The pull step will fail if images are missing." >&2
fi

echo "==> Syncing compose.prod.yaml to $HOST:$REMOTE_DIR..."
# shellcheck disable=SC2029
ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp infra/compose.prod.yaml "$HOST:$REMOTE_DIR/compose.prod.yaml"

echo "==> Deploying $VERSION on $HOST..."
# $VERSION and $REMOTE_DIR expand on the workstation before transmission (the
# block is double-quoted); the remote shell receives literal values. Keep it
# that way: single-quoting the block would send unexpanded names instead.
# shellcheck disable=SC2029
ssh "$HOST" "
  set -euo pipefail
  cd $REMOTE_DIR

  if [ ! -f .env ]; then
    echo 'Error: no .env beside compose.prod.yaml. Create it per the quickstart (PRIVANCE_IMAGE_PREFIX, PRIVANCE_VERSION; COMPOSE_PROJECT_NAME if migrating an existing stack).' >&2
    exit 1
  fi

  # Without a non-empty PRIVANCE_IMAGE_PREFIX, compose resolves bare local image
  # names and pull fails against Docker Hub instead of GHCR. Catch it before pulling.
  if ! grep -q '^PRIVANCE_IMAGE_PREFIX=..*' .env; then
    echo 'Error: PRIVANCE_IMAGE_PREFIX is missing or empty in .env (e.g. PRIVANCE_IMAGE_PREFIX=ghcr.io/<owner>/privance)' >&2
    exit 1
  fi

  # A stack originally brought up from a different directory has its volumes under
  # that directory's project name (e.g. infra_postgres_data). Running here without
  # pinning the project would create fresh empty volumes and boot an empty database.
  if docker volume inspect infra_postgres_data >/dev/null 2>&1 && ! grep -q '^COMPOSE_PROJECT_NAME=' .env; then
    echo 'Error: found legacy infra_* volumes but .env has no COMPOSE_PROJECT_NAME. Add COMPOSE_PROJECT_NAME=infra to .env so the existing data volumes are reused.' >&2
    exit 1
  fi

  # Pull with the new version as a transient override (shell env beats .env in
  # compose), so a failed pull leaves .env still pointing at the running version.
  PRIVANCE_VERSION=$VERSION docker compose -f compose.prod.yaml pull

  if grep -q '^PRIVANCE_VERSION=' .env; then
    sed -i 's|^PRIVANCE_VERSION=.*|PRIVANCE_VERSION=$VERSION|' .env
  else
    printf 'PRIVANCE_VERSION=$VERSION\n' >> .env
  fi

  docker compose -f compose.prod.yaml up -d
"

# The server container needs a few seconds to pass its healthcheck after
# recreate, so retry briefly.
echo "==> Running health checks..."
healthy=""
for _ in 1 2 3 4 5 6; do
  if curl -fsS "https://$DOMAIN/api/health"; then
    healthy=yes
    break
  fi
  sleep 5
done
if [ -z "$healthy" ]; then
  echo "" >&2
  echo "Error: health check failed for https://$DOMAIN/api/health" >&2
  echo "Inspect on the host: docker compose -f compose.prod.yaml ps; docker compose -f compose.prod.yaml logs server-migrate server" >&2
  exit 1
fi
echo ""
echo "    Health check passed."

last_modified=$(curl -sI "https://$DOMAIN/" | awk -F': ' 'tolower($1)=="last-modified"{print $2}')
echo "    Last-Modified: ${last_modified:-<not returned>}"

echo "==> Deploy complete: $VERSION is live at https://$DOMAIN"
