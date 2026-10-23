#!/bin/bash
# Run locally or in CI; all deploy commands are stubbed, never sent to a host.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/env" "$TMP/bin"
touch "$TMP/env/"{postgres.env,caddy.env,restic.env,postgres_password,restic_password}
cp infra/env.d.example/server.env "$TMP/env/server.env"
export PRIVANCE_ENV_DIR="$TMP/env"
unset PRIVANCE_HTTP_BIND PRIVANCE_HTTPS_BIND COMPOSE_PROFILES

docker compose -f infra/compose.local.yaml config --format json > "$TMP/local.json"
docker compose -f infra/compose.prod.yaml config --format json > "$TMP/default.json"
PRIVANCE_HTTP_BIND=127.0.0.1:8080 PRIVANCE_HTTPS_BIND=127.0.0.1:8443 COMPOSE_PROFILES=backups PRIVANCE_IMAGE_PREFIX=ghcr.io/example/privance PRIVANCE_VERSION=v1.2.3 \
  docker compose -f infra/compose.prod.yaml config --format json > "$TMP/private.json"
python3 - "$TMP" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
local, default, private = [json.loads((root / f'{name}.json').read_text())['services'] for name in ('local', 'default', 'private')]
assert local['caddy']['ports'][0]['host_ip'] == '127.0.0.1'
assert local['caddy']['ports'][0]['published'] == '8080'
assert len(default['caddy']['ports']) == 3
assert [p['published'] for p in default['caddy']['ports']] == ['80', '443', '443']
assert all(p.get('host_ip', '0.0.0.0') == '0.0.0.0' for p in default['caddy']['ports'])
assert [p['published'] for p in private['caddy']['ports']] == ['8080', '8443', '8443']
assert all(p['host_ip'] == '127.0.0.1' for p in private['caddy']['ports'])
assert private['caddy']['ports'][2]['protocol'] == 'udp'
for service in ('server', 'server-migrate'):
    assert private[service]['environment']['PRIVANCE_SECRETS_DIR'] == '/run/secrets'
    assert private[service]['environment']['INVITE_REQUIRED'] == 'false'
    assert 'ports' not in private[service]
assert 'restic-runner' not in default
assert 'restic-runner' in private
assert private['server']['image'] == 'ghcr.io/example/privance-server:v1.2.3'
PY

# The shim records calls; any unexpected command fails rather than contacting a host.
cat > "$TMP/bin/shim" <<'SH'
#!/bin/bash
printf '%s %s\n' "${0##*/}" "$*" >> "$CALLS"
case "${0##*/}" in
  git|scp|ssh|sleep) exit 0 ;;
  gh) printf '[{"status":"completed","conclusion":"success"}]\n' ;;
  curl) [ "${HEALTH_FAIL:-0}" = 0 ] ;;
  *) exit 1 ;;
esac
SH
chmod +x "$TMP/bin/shim"
for command in git scp ssh gh curl sleep; do ln -s shim "$TMP/bin/$command"; done
export PATH="$TMP/bin:$PATH" CALLS="$TMP/calls" PRIVANCE_DEPLOY_HOST=stub
unset PRIVANCE_DOMAIN
bash infra/deploy.sh v1.2.3 > "$TMP/no-domain.log"
grep -q 'skipping the health check' "$TMP/no-domain.log"
! grep -q '^curl ' "$CALLS"
PRIVANCE_DOMAIN=finance.example.com bash infra/deploy.sh v1.2.3 > "$TMP/healthy.log"
grep -q 'Health check passed' "$TMP/healthy.log"
grep -q 'https://finance.example.com/api/health' "$CALLS"
if HEALTH_FAIL=1 PRIVANCE_DOMAIN=finance.example.com bash infra/deploy.sh v1.2.3 > "$TMP/unhealthy.log" 2>&1; then
  echo 'Expected failed health check to reject deployment' >&2
  exit 1
fi
if bash infra/deploy.sh 'v1.2.3;false' > "$TMP/invalid.log" 2>&1; then
  echo 'Expected invalid version to be rejected' >&2
  exit 1
fi
printf 'Compose bindings, migration secrets, and deploy checks passed.\n'
