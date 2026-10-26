# Self-hosting Privance

Privance runs as a Docker Compose stack on a Linux host: API, Postgres, Caddy, and optional restic backups. Caddy handles public TLS or sits behind a private HTTPS proxy. Host configuration lives in `/etc/privance/env.d/`; production pulls release images without a source checkout or build toolchain.

## Choose the task

| Task | Procedure |
|---|---|
| Provision a new host | [Hetzner VPS example](hetzner-vps.md) |
| Install Privance | [Self-hosting quickstart](#self-hosting-quickstart) |
| Upgrade or roll back | [Updating a deployment](#updating-a-deployment) |
| Enable backups, inspect failures, or verify restoration | [Backups and restore drill](backups.md) |
| Restrict signup or mint an invite | [Invite-only signup](invites.md) |

## Self-hosting quickstart

Use this sequence for a **new installation**. For an existing deployment, use the upgrade procedure; do not regenerate its secrets. Commands run on the host from the deploy directory unless labeled “workstation”.

### Prerequisites

- Linux with Docker Engine 28+ and Compose. Minimum: 2 vCPU / 4 GB RAM / 40 GB disk. For installation, see [host setup step 9](hetzner-vps.md#step-9-docker-engine-and-compose-plugin). Older engines can expose loopback-published ports to other hosts ([Docker port-publishing documentation](https://docs.docker.com/engine/network/port-publishing/)).
- The deploy user can run `docker info` without sudo. If needed, run `sudo usermod -aG docker $USER`, then log out and back in. Docker-group membership is effectively root access; limit membership accordingly.
- Choose access mode before starting containers:

| Mode | Required configuration |
|---|---|
| Public HTTPS | Public domain, reachable DNS records and ports 80/TCP, 443/TCP, 443/UDP; Caddy terminates TLS |
| Private/reverse-proxy HTTPS | Browser-facing HTTPS proxy; configure [both loopback bindings](#reverse-proxy-or-private-network) before startup; public web ports stay closed |

**Docker bypasses UFW for published ports.** Postgres is loopback-bound; Caddy publishes on all interfaces by default. UFW alone does not make a private deployment private.

### Step 1: Authenticate with GHCR (only for private forks)

Official images are public; skip to step 2. Private forks need a GitHub classic personal access token with `read:packages` scope (fine-grained PATs do not work for GHCR authentication):

```bash
# Avoid session recording when handling credentials.
read -r -s -p 'GHCR token: ' GHCR_TOKEN
printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u '<your-github-username>' --password-stdin
unset GHCR_TOKEN
```

Complete when Docker reports `Login Succeeded`. The silent prompt keeps the token out of shell history and terminal echo; `--password-stdin` keeps it out of Docker's command-line arguments.

### Step 2: Create the deploy directory and .env file

```sh
mkdir -p ~/privance
cd ~/privance
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<version>/infra/compose.prod.yaml \
  -o compose.prod.yaml
tee .env >/dev/null <<'EOF'
PRIVANCE_IMAGE_PREFIX=ghcr.io/<owner>/privance
PRIVANCE_VERSION=<version>
EOF
```

Use the release tag you intend to run for both the Compose download and `PRIVANCE_VERSION`; `PRIVANCE_IMAGE_PREFIX` selects the registry prefix. Alternatively copy `infra/compose.prod.yaml` from that tag's local checkout. Enable the backup profile only at the indicated step in [backup setup](backups.md).

### Step 3: Create /etc/privance/env.d/ and write config files

```sh
sudo install -d -m 700 -o <deploy-user> -g <deploy-user> /etc/privance /etc/privance/env.d
stat -c '%a %U %G %n' /etc/privance /etc/privance/env.d
# Expected: both directories mode 700, owned by the deploy user.
```

The [environment templates](env.d.example/) are authoritative; these minimum configurations support a host without a checkout. Replace placeholders and keep each file mode 600.

**postgres.env:**

```sh
tee /etc/privance/env.d/postgres.env >/dev/null <<'EOF'
POSTGRES_USER=privance
POSTGRES_DB=privance
POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
EOF
chmod 600 /etc/privance/env.d/postgres.env
openssl rand -base64 48 | tr -d '\n' > /etc/privance/env.d/postgres_password
chmod 600 /etc/privance/env.d/postgres_password
sudo chown 10001:10001 /etc/privance/env.d/postgres_password
```

The API and migrations run as UID 10001 and must read the password file. Keep an out-of-band recovery copy without printing it to logs. **Never regenerate this password on an existing volume without also changing it in Postgres.**

**server.env:**

```sh
tee /etc/privance/env.d/server.env >/dev/null <<'EOF'
DATABASE_URL=postgres://privance@postgres:5432/privance
NODE_ENV=production
ENUMERATION_SECRET=<replace-with-output-of-openssl-rand-base64-48>
ALLOWED_ORIGINS=https://<your-domain>
INVITE_REQUIRED=false
EOF
chmod 600 /etc/privance/env.d/server.env
sed -i "s|<replace-with-output-of-openssl-rand-base64-48>|$(openssl rand -base64 48 | tr -d '\n')|" /etc/privance/env.d/server.env
```

Use a unique enumeration secret per instance. `ALLOWED_ORIGINS` is the browser-facing HTTPS origin without a trailing slash. Optional `FINNHUB_API_KEY` and `COINGECKO_API_KEY` settings are in the template; omit them unless needed.

**caddy.env:**

```sh
tee /etc/privance/env.d/caddy.env >/dev/null <<'EOF'
DOMAIN=<your-domain>
WWW_DOMAIN=www.<your-domain>
ACME_EMAIL=<operator-email>
LOCAL_HTTP_ONLY=
EOF
chmod 600 /etc/privance/env.d/caddy.env
```

For public HTTPS, leave `LOCAL_HTTP_ONLY` empty. For upstream TLS, apply the next section. Keep `ACME_EMAIL` set in either mode because Caddy parses the directive.

### Reverse proxy or private network

For TLS terminated outside Caddy, configure this **before starting the stack**. Add to the deploy `.env`:

```sh
PRIVANCE_HTTP_BIND=127.0.0.1:8080
PRIVANCE_HTTPS_BIND=127.0.0.1:8443
```

Set `DOMAIN=http://<instance-host>`, `WWW_DOMAIN=http://<instance-host>` (or an alias), and `LOCAL_HTTP_ONLY=auto_https off` in `caddy.env`. Set `ALLOWED_ORIGINS=https://<instance-host>` in `server.env`. The upstream proxy must preserve `Host` and forward to `http://127.0.0.1:8080` on the host; browsers use only the HTTPS URL.

#### Private network (Tailscale)

Install Tailscale using its [Linux guide](https://tailscale.com/docs/how-to/install/linux), join with `sudo tailscale up`, and enable MagicDNS and HTTPS certificates as required by [Serve](https://tailscale.com/docs/features/tailscale-serve).

Use `<node>.<tailnet>.ts.net` as `<instance-host>`; this name appears in public certificate-transparency logs. Use **Serve, not Funnel** (Funnel is public). Restrict tailnet access to your devices, protect the identity-provider account, and monitor node-key expiry. Keep `TRUSTED_PROXY_HOPS=1`; clients share an IP-based auth rate-limit bucket here. Do not trust arbitrary forwarded headers to avoid that limit.

Skip step 4; enable Serve after startup in step 5.

### Step 4: DNS setup (public HTTPS only)

Create DNS-only records (gray cloud with Cloudflare), TTL 300:

| Type | Name | Value |
|---|---|---|
| A | `@` | `<host-ipv4>` |
| A | `www` | `<host-ipv4>` |
| AAAA | `@` | `<host-ipv6>` |
| AAAA | `www` | `<host-ipv6>` |

Add AAAA only when IPv6 is configured and reachable. Verify each configured record from the workstation:

```sh
dig +short A <your-domain> @1.1.1.1
dig +short AAAA <your-domain> @1.1.1.1
dig +short A www.<your-domain> @1.1.1.1
dig +short AAAA www.<your-domain> @1.1.1.1
```

Proceed only when the configured records resolve to the host. Caddy's ACME retry backoff can delay another attempt; keep this guide's DNS-only mode rather than adding another TLS proxy during bring-up.

### Step 5: Bring the stack up

From `~/privance`:

```sh
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml logs -f caddy
```

Public mode: wait for `certificate obtained successfully`. If absent, recheck DNS and internet reachability of port 80; preserve certificate storage rather than deleting it to retry.

Tailscale mode: enable the HTTPS proxy now:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
sudo tailscale serve status
```

Complete when `docker compose -f compose.prod.yaml ps -a` shows `server-migrate` exited 0 and API/Postgres healthy. A failed migration blocks API startup.

### Step 6: Verify

Use the browser-facing HTTPS hostname as `<your-domain>`, including private deployments. In both modes:

```sh
curl -fsS https://<your-domain>/api/health
# Expected: {"ok":true,"service":"privance","ts":<number>}
curl -sI https://<your-domain>/ | grep -i location
# Expected: no Location header.
curl -fsS https://<your-domain>/ | grep -c '<title>Privance'
# Expected: 1.
curl -fsS -o /dev/null -w "%{http_code}\n" https://<your-domain>/app/accounts/
# Expected: 200 (SPA shell).
```

Caddy owns non-API response headers; Hono owns `/api/*`. Check both:

```sh
curl -sI https://<your-domain>/ | grep -iE '^(strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|content-security-policy):'
# Expected: six headers.
test "$(curl -sI https://<your-domain>/api/health | grep -ci '^content-security-policy:')" = "1"
test "$(curl -sI https://<your-domain>/api/health | grep -ci '^strict-transport-security:')" = "1"
# Both tests must exit 0: exactly one of each API header.
```

The web CSP permits the inline theme-bootstrap script in `index.html`; current header policy is in [Caddyfile](Caddyfile), not duplicated here.

**Public HTTPS only:** confirm HTTP redirects to HTTPS and certificate issuance succeeds:

```sh
curl -sI http://<your-domain>/ | grep -i location
# Expected: Location: https://<your-domain>/
openssl s_client -connect <your-domain>:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer
# Expected: issuer contains "Let's Encrypt".
```

Raise DNS TTLs to 3600 after success. Optionally run [SSL Labs](https://www.ssllabs.com/ssltest/) against the public hostname; target A or higher. For chain/stapling issues, reload Caddy with `docker compose -f compose.prod.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile`, wait, and retest.

**Private HTTPS only:** `docker compose -f compose.prod.yaml port caddy 80` must report `127.0.0.1:8080`, and port 443 must report `127.0.0.1:8443`. After step 7 succeeds, allow `tailscale0` in UFW if using Tailscale, and remove public 80/TCP, 443/TCP, 443/UDP rules from both host and provider firewalls. Preserve a tested SSH/recovery path. From outside the private network, test public IPv4 and IPv6: no HTTP response should be available; even an HTTP error indicates an exposed listener.

### Step 7: Create your first account

Open the instance, choose **Create an account**, and leave invite code empty with the default `INVITE_REQUIRED=false`. Save and verify the recovery phrase, reach Investments, then sign out and back in. These outcomes and the applicable step 6 checks complete initial deployment.

Public instances accept registrations by default. Restrict them with `SIGNUP_ALLOWLIST` or the [invite gate](invites.md). Existing installations keep their configured values. After changing `server.env`, use `docker compose -f compose.prod.yaml up -d server` rather than `restart` to reload it.

## Updating a deployment

Releases publish images on `v*` tags; [.github/workflows/release.yml](../.github/workflows/release.yml) defines the image tags. Use a full release version rather than a moving tag.

1. Review the release and its migration compatibility. Take and verify an on-demand backup using [the backup guide](backups.md#4-start-and-verify-the-scheduler); if restic is not configured, establish an equivalent tested recovery path before upgrading.
2. Preserve both private loopback bindings and any existing `COMPOSE_PROJECT_NAME` in the deploy `.env`.
3. From a workstation checkout, run:

   ```sh
   export PRIVANCE_DEPLOY_HOST=<ssh-alias-or-user@host>
   export PRIVANCE_DOMAIN=<instance-host>
   ./infra/deploy.sh vX.Y.Z
   ```

[deploy.sh](deploy.sh) checks the remote tag and release-workflow result, copies Compose, pulls images, then updates `PRIVANCE_VERSION` and recreates containers. A failed pull leaves the previous version selected. Private forks require the host's GHCR login from step 1. Omitting `PRIVANCE_DOMAIN` skips its health check; perform that check manually instead.

Without a workstation checkout, edit `PRIVANCE_VERSION` on the host, then run `docker compose -f compose.prod.yaml pull && docker compose -f compose.prod.yaml up -d` from the deploy directory.

The migration service runs before API startup. Backward-incompatible changes follow [expand → backfill → contract](../AGENTS.md#guardrails) across three deploys. Complete an upgrade only when migrations succeed, health checks pass, and browser sign-in and existing records work.

### Rollback

A failed health check leaves the new version selected; recovery is a human decision, not an automatic revert.

- No migration, or only a compatible additive migration: select the previous `PRIVANCE_VERSION` and run `docker compose -f compose.prod.yaml up -d`. Check health and browser behavior again.
- Incompatible schema/data changes: stop and plan recovery from a snapshot compatible with the previous release. [The side-database restore drill](backups.md#restore-drill) verifies a backup; it does not restore production. Confirm the database target and data-loss window before a production restore.

## Encrypted offsite backups via restic to Backblaze B2

Follow [backup setup, failure inspection, and restore verification](backups.md). This section remains as a landing point for existing links.

## Invite-only signup gating

Follow [gate configuration, token minting, and claim verification](invites.md). This section remains as a landing point for existing links.
