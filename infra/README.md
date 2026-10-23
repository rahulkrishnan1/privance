# Self-hosting Privance

Privance runs as a Docker Compose stack (server, Postgres, Caddy, and an optional restic backup scheduler) on a Linux host with Docker Engine installed. Caddy handles public TLS automatically via Let's Encrypt, or serves behind another HTTPS proxy for private access. All configuration lives in `/etc/privance/env.d/` on the host; there is no source checkout or build toolchain required on the server.

For a from-scratch hardened Hetzner VPS (SSH hardening, UFW, unattended-upgrades, Docker install, deploy user), see [hetzner-vps.md](hetzner-vps.md). That guide ends with the host ready for the quickstart below.

## Self-hosting quickstart

### Prerequisites

- A Linux host with Docker Engine 28+ and the Compose plugin installed (see Step 9 in hetzner-vps.md for the install procedure). Minimum: 2 vCPU / 4 GB RAM / 40 GB disk. Older engines can expose loopback-published ports to hosts on the same network ([Docker documentation](https://docs.docker.com/engine/network/port-publishing/)).
- Your deploy user in the `docker` group: `sudo usermod -aG docker $USER`, then log out and back in. Verify with `docker info` (must succeed without sudo; every command below assumes it).
- Either a private network with an HTTPS proxy (see below), or a domain pointing at the host for public HTTPS. A records are required for IPv4; add AAAA only if IPv6 is reachable.
- Backblaze B2 credentials for encrypted offsite backups (optional but strongly recommended).

WARNING: Docker bypasses UFW for published container ports (the `DOCKER` iptables chain precedes UFW). Postgres is loopback-bound. Caddy publishes 80 and 443 on all interfaces by default; private deployments must explicitly set both loopback bindings below.

### Step 1: Authenticate with GHCR (only for private forks)

The official Privance images are published as **public** packages on GHCR, so no GitHub authentication is needed to pull them; skip to Step 2.

If you are self-hosting from a **private fork** (your own private GHCR packages), authenticate first with a GitHub **classic** personal access token (Settings > Developer settings > Personal access tokens > Tokens (classic)) with `read:packages` scope; fine-grained PATs do not work for GHCR authentication:

```sh
# --password-stdin keeps the token out of shell history and process listings.
echo '<personal-access-token-with-read:packages>' | docker login ghcr.io -u <your-github-username> --password-stdin
# Expected: Login Succeeded
```

### Step 2: Create the deploy directory and .env file

```sh
mkdir -p ~/privance
cd ~/privance
```

Fetch the compose file from the release tag you intend to run. The repository is public, so the raw URL works without a token; alternatively copy from a local checkout (`scp infra/compose.prod.yaml <host>:~/privance/`).

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<version>/infra/compose.prod.yaml \
  -o compose.prod.yaml
```

Create the `.env` file beside it:

```sh
tee .env >/dev/null <<'EOF'
PRIVANCE_IMAGE_PREFIX=ghcr.io/<owner>/privance
PRIVANCE_VERSION=<version>
# COMPOSE_PROFILES=backups
EOF
```

`PRIVANCE_IMAGE_PREFIX` sets the image registry prefix; `PRIVANCE_VERSION` selects the tag pulled from GHCR. Uncomment `COMPOSE_PROFILES=backups` to enable the restic backup scheduler; without it no B2 configuration is needed (you can add it later).

### Step 3: Create /etc/privance/env.d/ and write config files

Create the secrets directory (mode 700):

```sh
sudo install -d -m 700 -o <deploy-user> -g <deploy-user> /etc/privance /etc/privance/env.d
stat -c '%a %U %G %n' /etc/privance /etc/privance/env.d
# Expected: two lines, "700 <deploy-user> <deploy-user> ..."
```

Copy the example templates from the repo (or inline them as shown below), then fill in real values. Each file must be mode 600. The templates in `infra/env.d.example/` are the canonical versions; the blocks below mirror them for hosts without a checkout.

**postgres.env** (`/etc/privance/env.d/postgres.env`):

```sh
tee /etc/privance/env.d/postgres.env >/dev/null <<'EOF'
POSTGRES_USER=privance
POSTGRES_DB=privance
POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
EOF
chmod 600 /etc/privance/env.d/postgres.env
```

**postgres_password** (Docker secret, no extension):

```sh
openssl rand -base64 48 | tr -d '\n' > /etc/privance/env.d/postgres_password
chmod 600 /etc/privance/env.d/postgres_password
sudo chown 10001:10001 /etc/privance/env.d/postgres_password
```

The API and migrations run as UID 10001 and need to read this mode-600 file. Keep a recovery copy in your password manager without printing it to logs. Never regenerate the password on an existing volume without also changing it in Postgres.

**server.env** (`/etc/privance/env.d/server.env`): start from `infra/env.d.example/server.env` in the repo; the minimum required values are:

```sh
tee /etc/privance/env.d/server.env >/dev/null <<'EOF'
DATABASE_URL=postgres://privance@postgres:5432/privance
NODE_ENV=production
ENUMERATION_SECRET=<replace-with-output-of-openssl-rand-base64-48>
ALLOWED_ORIGINS=https://<your-domain>
INVITE_REQUIRED=false
EOF
chmod 600 /etc/privance/env.d/server.env
```

The template also carries optional price-feed failover keys (`FINNHUB_API_KEY`, `COINGECKO_API_KEY`); both are free and absent-by-default, so skip them unless you want the extra resilience.

Fill in `ENUMERATION_SECRET` without the value transiting your terminal or shell history:

```sh
sed -i "s|<replace-with-output-of-openssl-rand-base64-48>|$(openssl rand -base64 48 | tr -d '\n')|" /etc/privance/env.d/server.env
```

Do not reuse the secret across instances.

**caddy.env** (`/etc/privance/env.d/caddy.env`):

```sh
tee /etc/privance/env.d/caddy.env >/dev/null <<'EOF'
DOMAIN=<your-domain>
WWW_DOMAIN=www.<your-domain>
ACME_EMAIL=<operator-email>
LOCAL_HTTP_ONLY=
EOF
chmod 600 /etc/privance/env.d/caddy.env
```

Leave `LOCAL_HTTP_ONLY` empty when Caddy terminates public HTTPS. For TLS terminated by an upstream proxy, use the loopback configuration below. Keep `ACME_EMAIL` set in either mode; Caddy still parses that directive.

**restic.env and restic_password** (only when backups are enabled via `COMPOSE_PROFILES=backups`; skip both files otherwise):

```sh
tee /etc/privance/env.d/restic.env >/dev/null <<'EOF'
B2_ACCOUNT_ID=<keyID from privance-restic-prod>
B2_ACCOUNT_KEY=<applicationKey from privance-restic-prod>
RESTIC_REPOSITORY=b2:<your-bucket-name>:/restic
RESTIC_PASSWORD_FILE=/run/secrets/restic_password
EOF
chmod 600 /etc/privance/env.d/restic.env

openssl rand -base64 48 | tr -d '\n' > /etc/privance/env.d/restic_password
chmod 600 /etc/privance/env.d/restic_password
```

WARNING: if `restic_password` is lost, every snapshot is permanently unrecoverable. Store it out-of-band before proceeding.

### Reverse proxy or private network

Choose this mode **before starting the stack** if TLS terminates outside Caddy. Add to the deploy `.env`:

```sh
PRIVANCE_HTTP_BIND=127.0.0.1:8080
PRIVANCE_HTTPS_BIND=127.0.0.1:8443
```

In `caddy.env`, set `DOMAIN=http://<instance-host>`, `WWW_DOMAIN=http://<instance-host>` (or an alias), and `LOCAL_HTTP_ONLY=auto_https off`; retain `ACME_EMAIL`. In `server.env`, set `ALLOWED_ORIGINS=https://<instance-host>` to the browser-facing origin, without a trailing slash. Your HTTPS proxy must preserve `Host` and forward to `http://127.0.0.1:8080` on the Docker host. The browser must never use that backend HTTP URL.

#### Private network (Tailscale)

Install Tailscale on the host and clients using its [Linux setup guide](https://tailscale.com/docs/how-to/install/linux), then join with `sudo tailscale up`. Enable MagicDNS and HTTPS certificates in the tailnet's DNS settings as required by [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

Use the full MagicDNS name (`<node>.<tailnet>.ts.net`) as `<instance-host>` above. This name appears in public certificate-transparency logs. Use **Serve, not Funnel**: Funnel makes services public. Restrict tailnet access to your devices, protect your identity-provider account, and monitor node-key expiry. Keep `TRUSTED_PROXY_HOPS=1`; clients share an IP-based auth rate-limit bucket in this setup. Do not trust arbitrary forwarded headers to work around it.

Skip public DNS setup below. Enable Serve after the stack starts in Step 5.

### Step 4: DNS setup (public HTTPS only)

Create records for your primary hostname and any alias, all DNS-only (gray cloud if using Cloudflare), TTL 300. Only add AAAA when IPv6 is configured and reachable:

| Type | Name  | Value |
|------|-------|-------|
| A    | `@`   | `<host-ipv4>` |
| A    | `www` | `<host-ipv4>` |
| AAAA | `@`   | `<host-ipv6>` |
| AAAA | `www` | `<host-ipv6>` |

Orange-cloud proxy mode breaks HTTP-01 challenge; keep gray. Raise TTL to 3600 after HTTPS works.

Verify propagation from your workstation:

```sh
dig +short A <your-domain> @1.1.1.1
dig +short AAAA <your-domain> @1.1.1.1
dig +short A www.<your-domain> @1.1.1.1
dig +short AAAA www.<your-domain> @1.1.1.1
```

Do not proceed until the records you configured return the correct host address. Caddy's ACME retry backoff can delay the next attempt by hours.

### Step 5: Bring the stack up

From the deploy directory (`~/privance`):

```sh
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml logs -f caddy
```

For public HTTPS, watch for `certificate obtained successfully`. If absent, recheck DNS and that port 80 is reachable from the internet; do not delete certificate storage to retry issuance.

For Tailscale, enable the host's HTTPS proxy now:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
sudo tailscale serve status
```

Confirm `server-migrate` exited 0 and the API/Postgres are healthy with `docker compose -f compose.prod.yaml ps -a`. A failed migration blocks API startup.

### Step 6: Verify

Use your browser-facing HTTPS hostname as `<your-domain>` below, including for private access. HTTP redirect, public DNS, certificate-issuer and SSL Labs checks apply only when Caddy manages public HTTPS.

```sh
curl -fsS https://<your-domain>/api/health
# Expected: {"ok":true,"service":"privance","ts":<number>}

curl -sI https://<your-domain>/ | grep -i location
# Expected: no Location header

curl -sI http://<your-domain>/ | grep -i location
# Expected: Location: https://<your-domain>/
```

For public HTTPS, raise the configured DNS TTLs from 300 to 3600 once HTTPS works.

For private access, `docker compose -f compose.prod.yaml port caddy 80` must show `127.0.0.1:8080`, and port 443 must show `127.0.0.1:8443`. After browser signup/login works, allow `tailscale0` in UFW and remove public 80/TCP, 443/TCP and 443/UDP rules from both host and provider firewalls. Keep a tested SSH/recovery path. From outside the tailnet, check public IPv4 and IPv6: no HTTP response should be available; even an HTTP error means a listener is exposed.

### Step 7: Create your first account

Open your instance and choose **Create an account**. The template sets `INVITE_REQUIRED=false`, so leave the invite-code field empty. Save the recovery phrase and complete its verification, then check sign-out and sign-in.

Public instances allow anyone to register by default. To restrict registration, configure `SIGNUP_ALLOWLIST` or enable the optional [invite-only gate](#invite-only-signup-gating). Existing deployments retain their own settings; after editing `server.env`, use `docker compose -f compose.prod.yaml up -d server`, not `restart`, to reload them.

**Security headers on / and /api/***

Caddy emits headers on `/` only (via the `@notapi { not path /api/* }` matcher); Hono emits its own on `/api/*`.

```sh
curl -sI https://<your-domain>/ | grep -iE '^(strict-transport|x-content-type|referrer-policy|permissions-policy|x-frame-options|content-security-policy):'
# Expected: six lines

[ "$(curl -sI https://<your-domain>/api/health | grep -ci '^content-security-policy:')" = "1" ] && echo "CSP count: 1 (PASS)" || echo "CSP count: unexpected (FAIL)"
[ "$(curl -sI https://<your-domain>/api/health | grep -ci '^strict-transport-security:')" = "1" ] && echo "HSTS count: 1 (PASS)" || echo "HSTS count: unexpected (FAIL)"
```

CSP includes `'unsafe-inline'` in `script-src` because the Vite SPA inlines the dark-mode detection script in `index.html`; nonces require SSR.

**SSL Labs scan:**

```sh
openssl s_client -connect <your-domain>:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer
# Expected: Issuer contains "Let's Encrypt"

curl -fsS https://<your-domain>/ | grep -c '<title>Privance'
# Expected: 1

curl -fsS -o /dev/null -w "%{http_code}\n" https://<your-domain>/app/accounts/
# Expected: 200
```

Browse `https://www.ssllabs.com/ssltest/analyze.html?d=<your-domain>&hideResults=on`. Target A or higher (A+ is realistic with Caddy 2 defaults plus 1-year HSTS).

If a cert chain or stapling problem appears: `docker compose -f compose.prod.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile`, wait 60 seconds, re-scan.

## Updating a deployment

Releases are built by GitHub Actions when a `v*` tag is pushed. The workflow builds and pushes `ghcr.io/<owner>/privance-{server,web,restic-runner}` images tagged with the full semver version (`vX.Y.Z`) and the major.minor version (`vX.Y`).

To deploy a new version from your workstation:

```sh
export PRIVANCE_DEPLOY_HOST=<ssh-alias-or-user@host>
export PRIVANCE_DOMAIN=<instance-host> # browser-facing HTTPS health-check target
./infra/deploy.sh vX.Y.Z
```

Public images pull without authentication. From a private fork, the host must hold a valid GHCR login for the pull step (quickstart Step 1); `docker login` credentials persist until revoked, so this is one-time per host.

`deploy.sh` verifies the tag exists on origin, checks that the release workflow completed successfully, copies `compose.prod.yaml` to the remote deploy directory, pulls the new images (with the target version as a transient override, so a failed pull leaves `.env` pointing at the running version), then updates `PRIVANCE_VERSION` in `.env`, runs `docker compose up -d`, and health-checks the result. If `PRIVANCE_DOMAIN` is omitted, it explicitly skips the health check; verify manually. Preserve both private loopback bindings and any existing `COMPOSE_PROJECT_NAME` in `.env` so updates use the same access boundary and volumes.

Without a repo checkout, update manually on the host from the deploy directory: edit `PRIVANCE_VERSION` in `.env`, then `docker compose -f compose.prod.yaml pull && docker compose -f compose.prod.yaml up -d`.

The `server-migrate` service runs automatically (via `depends_on`) before the server container starts. It is a no-op when no new migrations are pending. Schema changes that follow the expand-backfill-contract pattern can be shipped this way without downtime; single-deploy destructive renames are not safe and must be split across two deploys.

### Rollback

If a deploy fails its health check, the stack is left on the new version; recovery is manual by design (a failed health check on a finance app warrants a human decision, not a silent revert).

- No migration in the failed release: edit `PRIVANCE_VERSION` in the deploy directory's `.env` back to the previous tag, then `docker compose -f compose.prod.yaml up -d`. The previous images are still in the local Docker cache.
- A migration ran: expand-phase migrations are additive, so the previous server version runs safely against the new schema and the step above still works. Anything beyond expand-phase means restoring from the latest snapshot (see the restore drill) before bringing up the previous version.
- Before every upgrade, take an on-demand backup so the pre-upgrade state is one snapshot away: `docker compose -f compose.prod.yaml run --rm restic-runner /usr/local/bin/backup.sh`.

## Encrypted offsite backups via restic to Backblaze B2

### Step 1: Create the B2 bucket and application keys

In the Backblaze console (https://www.backblaze.com/):

1. Buckets > Create a Bucket: name `<your-bucket-name>`, Files Private, Default Encryption Disable (restic encrypts client-side), Object Lock Disable, Lifecycle "Keep all versions".
2. App Keys > Add a New Application Key: name `privance-restic-prod`, scope to the bucket, type Read and Write, "Allow List All Bucket Names" unchecked. Copy `keyID` and `applicationKey` to the password manager (applicationKey is shown once).
3. Mint a second key `privance-restic-restore-readonly`, type Read Only, same bucket. Store separately. Its purpose is disaster recovery from a machine other than the production host (a stolen or compromised restore machine then cannot delete or alter snapshots); the in-place drill below runs on the host and uses the read-write key already present there.

### Step 2: Store the restic repository password out-of-band

The password file itself was created in Step 3 of the quickstart. WARNING: if it is lost, every snapshot is permanently unrecoverable; store a copy out-of-band before initialising the repository.

```sh
cat /etc/privance/env.d/restic_password
# Copy the printed value to the password manager as "Privance restic repo password",
# then clear the terminal.
```

### Step 3: Initialise the restic repository in B2

One-shot; the scheduler never calls `init`.

```sh
RESTIC_DR="docker run --rm --env-file /etc/privance/env.d/restic.env -v /etc/privance/env.d/restic_password:/run/secrets/restic_password:ro restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76"

$RESTIC_DR init
# Expected: "created restic repository <repo-id> at b2:<your-bucket-name>:/restic"
$RESTIC_DR snapshots
# Expected: header "ID  Time  Host  Tags  Paths  Size", no data rows, exit 0
$RESTIC_DR init
# Expected: non-zero exit, stderr contains "config file already exists"
```

### Step 4: Bring up the long-running scheduler

Requires `COMPOSE_PROFILES=backups` in the deploy directory's `.env` (quickstart Step 2); without it compose does not know the service.

```sh
docker compose -f compose.prod.yaml up -d restic-runner
docker compose -f compose.prod.yaml ps restic-runner
# Expected: privance-restic-runner-1 with STATUS running and COMMAND `crond -f -l 8`
# (compose.prod.yaml pins the project name to "privance")
```

Cron runs `backup.sh` nightly at 03:30 UTC and `check.sh` Sundays at 04:00 UTC. On-demand:

```sh
docker compose -f compose.prod.yaml run --rm restic-runner /usr/local/bin/backup.sh
```

### Step 5: Daily log-inspection habit

```sh
docker compose -f compose.prod.yaml logs --tail=40 restic-runner
```

Healthy: daily `backup succeeded` + `forget+prune succeeded` + `nightly run complete`; weekly `restic check succeeded`.

Problem signals:
- `BACKUP FAILED with exit code N`: re-run on-demand and read the error. Common causes: stale B2 key in `restic.env`, postgres unhealthy at run time, B2 quota.
- `RESTIC CHECK FAILED`: re-run `check.sh` to confirm before assuming corruption.
- No log entries at 03:30 UTC: cron wedged; `docker compose restart restic-runner`.

Skim weekly.

### Step 6: Restore drill (in-place verification)

Run after first bring-up and at least quarterly. Restores latest snapshot into a side database, diffs row counts vs production, drops it.

```sh
# 1. Production baseline row counts
docker compose -f compose.prod.yaml exec postgres psql -U privance -d privance -c "
  SELECT schemaname || '.' || relname AS table_name, n_live_tup
  FROM pg_stat_user_tables ORDER BY table_name;
"

# 2. Latest snapshot
docker compose -f compose.prod.yaml run --rm restic-runner restic snapshots --tag db --tag nightly --latest 1

# 3. Create side database
docker compose -f compose.prod.yaml exec postgres psql -U privance -d postgres \
  -c 'DROP DATABASE IF EXISTS privance_restore_test;' \
  -c 'CREATE DATABASE privance_restore_test;'

# 4. Stream snapshot through pg_restore
docker compose -f compose.prod.yaml run --rm restic-runner sh -c '
  PGPASS=$(cat /run/secrets/postgres_password)
  restic dump --tag db --tag nightly latest /privance.dump | PGPASSWORD="$PGPASS" pg_restore \
    --no-owner --no-acl --clean --if-exists \
    -h postgres -U privance -d privance_restore_test
'

# 5. Re-run step 1 against -d privance_restore_test; row counts must match production
#    (only delta: writes after snapshot timestamp).

# 6. Clean up
docker compose -f compose.prod.yaml exec postgres psql -U privance -d postgres -c 'DROP DATABASE privance_restore_test;'
```

## Invite-only signup gating

When active, `POST /api/auth/signup` requires a valid `invite_token`; missing, expired, or already-used tokens get HTTP 403. Default off. Tokens are minted via a Bun CLI; plaintext is written to stdout exactly once and never logged.

### Step 1: Enable the gate in production

The quickstart leaves this disabled. To enable it, change the existing `INVITE_REQUIRED=false` entry in `/etc/privance/env.d/server.env` to `INVITE_REQUIRED=true`, then recreate the API:

```sh
docker compose -f compose.prod.yaml up -d server
docker compose -f compose.prod.yaml logs --tail=20 server
```

Any value other than the string `"true"` keeps signup open.

### Step 2: Mint an invite token

```sh
docker compose -f compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops
```

Expected, in order: one JSON pino log line with `"tokenId":"..."` and `"createdBy":"ops"` (NOT the plaintext), then one plaintext line (43 base64url characters, no `=` padding). Exit 0.

With expiry:

```sh
docker compose -f compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops --expires-in 30d
```

Duration suffix: `d`, `h`, `m`. The log line includes `"expiresAt":"<iso-timestamp>"`.

Note: if signup fails AFTER an invite token is claimed (rare: unique-username race, Argon2id failure), the token is permanently consumed and the inviter must mint a fresh one.

### Step 3: Safe handoff to the invitee

Copy the token, then clear the terminal before anything else (`clear`, or close the SSH session; in tmux/screen also clear the pane history). Send via a single-use ephemeral channel (Signal disappearing messages, encrypted email, in-person). The DB stores only a hash; once terminal scrollback is cleared, the plaintext is unrecoverable.

### Step 4: Verify mint and claim against the database

```sh
docker compose -f compose.prod.yaml exec postgres psql -U privance -d privance
```

```sql
SELECT token_id, created_by, created_at, expires_at, used_at
FROM invite_tokens ORDER BY created_at DESC LIMIT 1;
-- Expected: created_by = 'ops', expires_at NULL or future, used_at NULL

SELECT event_class, user_id, occurred_at
FROM audit_events ORDER BY occurred_at DESC LIMIT 1;
-- Expected: event_class = 'invite_minted', user_id NULL
```

After signup using the token, `used_at` is set and `used_by_user_id` references the new user; `audit_events` gets a `signup_succeeded` row.

### Step 5: End-to-end verification (one-time)

Sign up at `https://<your-domain>` in a real browser using a freshly minted plaintext token. Account is created; `invite_tokens.used_at` and `used_by_user_id` populate; `audit_events` contains `signup_succeeded` for the new user.
