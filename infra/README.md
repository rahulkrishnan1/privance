# Self-hosting Privance

Bring-up runbook for a self-hosted Privance instance on a Hetzner Cloud VPS: from a fresh Ubuntu image to a hardened host running the full stack (TLS, backups, invite gating).

## Prerequisites

- Hetzner Cloud account with billing configured. IPv4 is billed extra; see Hetzner's pricing.
- Ed25519 SSH key: `ssh-keygen -t ed25519 -C "privance-deploy" -f ~/.ssh/id_ed25519_privance`.
- A domain (or subdomain) for the instance.
- Linux, macOS, or WSL2 workstation.

## Choosing a region and SKU

| SKU | Arch | Regions | vCPU/RAM/Disk/Traffic |
|-----|------|---------|----------------------|
| CX23 | x86 | EU (fsn1, nbg1, hel1) | 2 / 4 GB / 40 GB / 20 TB |
| CAX11 | ARM64 | EU (fsn1, nbg1, hel1) | 2 / 4 GB / 40 GB / 20 TB |
| CPX22 | x86 | Global (ash, sin) | 2 / 4 GB / 40 GB / 1 TB |

Default CX23. CPX22 if non-EU. Region cannot be changed after creation; server can be resized within a family only. Consult Hetzner's pricing page for current rates.

## Step 1: Register your SSH key with Hetzner

In the Hetzner Console, Security > SSH Keys > Add SSH Key. Paste `~/.ssh/id_ed25519_privance.pub`, name it with a year-month tag (e.g. `privance-deploy-YYYY-MM`), save. Do NOT enable "set as default key". Verify fingerprint matches `ssh-keygen -lf ~/.ssh/id_ed25519_privance.pub`.

## Step 2: Create the Cloud Firewall

In the Hetzner Console, Firewalls > Create Firewall, name `privance-edge`, all inbound from `0.0.0.0/0, ::/0`:

| Protocol | Port | Description                     |
|----------|------|---------------------------------|
| TCP      | 22   | SSH                             |
| TCP      | 80   | HTTP (Let's Encrypt + redirect) |
| TCP      | 443  | HTTPS                           |
| UDP      | 443  | HTTPS/3 (QUIC)                  |

Outbound: defaults (allow all). Save; do not attach yet.

## Step 3: Create the server

In the Hetzner Console, Servers > Add Server: Ubuntu 24.04 LTS, the SKU and region from above, both IPv4 and IPv6, SSH key from Step 1, `privance-edge` firewall from Step 2, no volumes, Backups off, no placement group, name `privance-prod-01`, empty cloud config.

Hetzner Backups are off because restic to a different provider handles backups (see below). Record the Public IPv4 and IPv6.

## Step 4: First SSH and base update

```sh
ssh -i ~/.ssh/id_ed25519_privance -o IdentitiesOnly=yes root@<ipv4>
```

Cross-check the host key fingerprint against the Hetzner Console. Keep this session open until Step 6 confirms the deploy user.

```sh
apt-get update
apt-get -y upgrade
apt-get install -y update-notifier-common ufw unattended-upgrades
[ -f /var/run/reboot-required ] && echo "REBOOT NEEDED" || echo "no reboot needed"
```

If reboot needed, `reboot` then reconnect.

## Step 5: Create the deploy user and plant the SSH key

On the VPS as root (placeholder name `privance`; substitute your own):

```sh
adduser --gecos "" <deploy-user>
# Prompts for the sudo password. Use a strong one; do not reuse the SSH key passphrase.

install -d -m 700 -o <deploy-user> -g <deploy-user> /home/<deploy-user>/.ssh
echo '<paste-the-public-key-line-here>' > /home/<deploy-user>/.ssh/authorized_keys
chmod 600 /home/<deploy-user>/.ssh/authorized_keys
chown <deploy-user>:<deploy-user> /home/<deploy-user>/.ssh/authorized_keys

echo '<deploy-user> ALL=(ALL) PASSWD: ALL' > /etc/sudoers.d/<deploy-user>
chmod 440 /etc/sudoers.d/<deploy-user>
visudo -cf /etc/sudoers.d/<deploy-user>
# Expected: "/etc/sudoers.d/<deploy-user>: parsed OK"
```

## Step 6: Verify the deploy user, then harden sshd

Keep the Step 4 root session open as an escape hatch. In a second terminal: `ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4>` (must land at `$` prompt), then `sudo -v` (returns silently on correct password). Only when both succeed, write the hardened sshd drop-in:

```sh
sudo tee /etc/ssh/sshd_config.d/00-privance.conf >/dev/null <<'EOF'
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
KexAlgorithms curve25519-sha256@libssh.org,ecdh-sha2-nistp521,ecdh-sha2-nistp384,ecdh-sha2-nistp256,diffie-hellman-group-exchange-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com,hmac-sha2-512,hmac-sha2-256,umac-128@openssh.com
LogLevel VERBOSE
ClientAliveInterval 300
ClientAliveCountMax 0
MaxAuthTries 3
MaxSessions 5
EOF

sudo sshd -t
# Expected: no output. Anything else means STOP and fix before reload.
sudo systemctl reload ssh
```

Verify from your workstation; all three must pass before logging out of the original root session:

```sh
ssh -i ~/.ssh/id_ed25519_privance root@<ipv4> whoami
# Expected: "Permission denied (publickey)."
ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4> whoami
# Expected: prints "<deploy-user>"
ssh -o PreferredAuthentications=password -o BatchMode=yes <deploy-user>@<ipv4> whoami
# Expected: "Permission denied (publickey)."
```

## Step 7: UFW on the host

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp comment 'SSH (rate-limited)'
sudo ufw allow 80/tcp comment 'HTTP (LE challenge + redirect)'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 443/udp comment 'HTTPS/3 (QUIC)'
sudo ufw --force enable
sudo ufw status verbose
# Expected: four rules each on IPv4 and IPv6: 22/tcp LIMIT, 80/tcp ALLOW, 443/tcp ALLOW, 443/udp ALLOW
```

From your workstation, `nmap -Pn -p 5432 <ipv4>` should report 5432 as filtered.

## Step 8: Unattended-upgrades

As the deploy user:

```sh
sudo tee /etc/apt/apt.conf.d/52privance-unattended-upgrades >/dev/null <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

sudo unattended-upgrade --dry-run
# Expected: exits 0.
```

## Step 9: Docker Engine and Compose plugin

Install from Docker's official apt repository, pin the exact version. As the deploy user:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

ARCH=$(dpkg --print-architecture)
CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${CODENAME}
Components: stable
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
```

Run `apt-cache madison docker-ce`, copy the latest version string, and install at exactly that version:

```sh
# Substitute <VERSION_STRING> with the value from `apt-cache madison docker-ce`.
sudo apt-get install -y \
  docker-ce=<VERSION_STRING> \
  docker-ce-cli=<VERSION_STRING> \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
sudo apt-mark hold docker-ce docker-ce-cli containerd.io

docker --version
docker compose version
systemctl is-active docker
apt-mark showhold
```

To upgrade later: `sudo apt-mark unhold docker-ce docker-ce-cli containerd.io`, upgrade, re-hold.

## Step 10: Add the deploy user to the `docker` group

```sh
sudo usermod -aG docker $USER
exit
ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4>
groups                          # lists "docker"
docker info | head -5           # succeeds without sudo
docker run --rm hello-world
```

WARNING: docker group is effectively root (`docker run -v /:/host alpine chroot /host` escalates). Keep to the deploy user only.

## Step 11: Create the secrets directory

Secrets live in `/etc/privance/env.d/`, mode 700, owned by the deploy user; env files mode 600.

```sh
sudo install -d -m 700 -o <deploy-user> -g <deploy-user> /etc/privance /etc/privance/env.d
stat -c '%a %U %G %n' /etc/privance /etc/privance/env.d
# Expected: two lines, "700 <deploy-user> <deploy-user> ..."
```

WARNING: Docker bypasses UFW for published container ports (the `DOCKER` iptables chain precedes UFW). Bind non-public services to `127.0.0.1` in compose (e.g. `127.0.0.1:5432:5432`); only the reverse proxy binds `0.0.0.0:80`/`0.0.0.0:443`.

## Rollback notes

- Wrong region or SKU: delete and recreate; within-family resize works in-place.
- Locked out by sshd: `sudo rm /etc/ssh/sshd_config.d/00-privance.conf && sudo systemctl reload ssh`. If no session remains, use the Hetzner Console KVM (root login works there).
- UFW broke routing: `sudo ufw disable`, then re-apply Step 7.
- Unattended-upgrades misbehaving: `sudo rm /etc/apt/apt.conf.d/52privance-unattended-upgrades`.
- Wrong Docker version: unhold, reinstall at the correct version, re-hold.
- Wrong deploy user: `sudo userdel -r <name>` then re-run Step 5.

## TLS and DNS

Caddy obtains and renews Let's Encrypt TLS via ACME, serves the Next.js static export at `/`, and reverse-proxies `/api/*` to the Hono server. Security headers (HSTS, CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options) come from Caddy on `/` and Hono on `/api/*`. Cloudflare is DNS-only.

### Step 1: Create Cloudflare DNS records

In the `privance.app` zone (DNS > Records), create four records all DNS-only (gray cloud), TTL 300:

| Type | Name  | Value |
|------|-------|-------|
| A    | `@`   | `<vps-ipv4>` |
| A    | `www` | `<vps-ipv4>` |
| AAAA | `@`   | `<vps-ipv6>` |
| AAAA | `www` | `<vps-ipv6>` |

Orange-cloud proxy mode breaks HTTP-01; keep gray. Raise TTL to 3600 after HTTPS works.

Verify propagation from your workstation:

```sh
dig +short A privance.app @1.1.1.1
dig +short AAAA privance.app @1.1.1.1
dig +short A www.privance.app @1.1.1.1
dig +short AAAA www.privance.app @1.1.1.1
```

Do not proceed until all four return correct values; Caddy's ACME retry backoff can delay the next attempt by hours.

### Step 2: Write caddy.env on the VPS

As the deploy user:

```sh
sudo tee /etc/privance/env.d/caddy.env >/dev/null <<'EOF'
DOMAIN=privance.app
WWW_DOMAIN=www.privance.app
ACME_EMAIL=<operator-email>
LOCAL_HTTP_ONLY=
EOF
sudo chmod 600 /etc/privance/env.d/caddy.env
```

`<operator-email>` is the ACME account address. `LOCAL_HTTP_ONLY` must be empty in production (setting it to `auto_https off` disables TLS).

### Step 3: Build the web static export and rsync to the VPS

Caddy serves `apps/web/out/` directly via bind mount. From the repo root on your workstation:

```sh
pnpm --filter @privance/web build
rsync -avz apps/web/out/ <deploy-user>@<vps-ipv4>:/home/<deploy-user>/privance/apps/web/out/
```

### Step 4: Bring the stack up

As the deploy user, from the repo root:

```sh
cd infra
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml logs -f caddy
```

Watch for `certificate obtained successfully` (within two minutes). If absent, recheck DNS and port 80.

```sh
curl -fsS https://privance.app/api/health
# Expected: {"ok":true,"service":"privance","ts":<number>}
curl -sI https://privance.app/ | grep -i location
# Expected: no Location header
curl -sI http://privance.app/ | grep -i location
# Expected: Location: https://privance.app/
```

Once HTTPS works, raise all four Cloudflare DNS TTLs from 300 to 3600.

### Step 5: Verify security headers on / and /api/*

Caddy emits headers on `/` only (via the `@notapi { not path /api/* }` matcher); Hono emits its own on `/api/*`.

```sh
curl -sI https://privance.app/ | grep -iE '^(strict-transport|x-content-type|referrer-policy|permissions-policy|x-frame-options|content-security-policy):'
# Expected: six lines

# No Caddy duplication on /api/*:
[ "$(curl -sI https://privance.app/api/health | grep -ci '^content-security-policy:')" = "1" ] && echo "CSP count: 1 (PASS)" || echo "CSP count: unexpected (FAIL)"
[ "$(curl -sI https://privance.app/api/health | grep -ci '^strict-transport-security:')" = "1" ] && echo "HSTS count: 1 (PASS)" || echo "HSTS count: unexpected (FAIL)"
```

CSP includes `'unsafe-inline'` in `script-src` because the Next.js static export emits inline RSC hydration scripts; nonces require SSR.

### Step 6: SSL Labs scan

```sh
openssl s_client -connect privance.app:443 </dev/null 2>/dev/null | openssl x509 -noout -issuer
# Expected: Issuer contains "Let's Encrypt"
curl -fsS https://privance.app/ | grep '<title>Privance</title>'
# Expected: one matching line
curl -fsS -o /dev/null -w "%{http_code}\n" https://privance.app/accounts/
# Expected: 200
```

SSL Labs: browse `https://www.ssllabs.com/ssltest/analyze.html?d=privance.app&hideResults=on`. Target A or higher (A+ realistic with Caddy 2 defaults + 1y HSTS).

If a cert chain or stapling problem appears: `docker compose -f compose.prod.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile`, wait 60 seconds, re-scan.

## Encrypted offsite backups via restic to Backblaze B2

### Step 1: Create the B2 bucket and application keys

In the Backblaze console (https://www.backblaze.com/):

1. Buckets > Create a Bucket: name `privance-backups-prod`, Files Private, Default Encryption Disable (restic encrypts client-side), Object Lock Disable, Lifecycle "Keep all versions".
2. App Keys > Add a New Application Key: name `privance-restic-prod`, scope to `privance-backups-prod`, type Read and Write, "Allow List All Bucket Names" unchecked. Copy `keyID` and `applicationKey` to the password manager (applicationKey is shown once).
3. Mint a second key `privance-restic-restore-readonly`, type Read Only, same bucket. Store separately, labelled "restore drill only".

### Step 2: Generate the restic repository password on the VPS

WARNING: if this password is lost, every snapshot is permanently unrecoverable. Generate once, store out-of-band, never re-derive.

```sh
openssl rand -base64 48
```

Copy the single-line output to the password manager as "Privance restic repo password (privance-backups-prod)".

### Step 3: Write restic.env and restic_password on the VPS

```sh
sudo tee /etc/privance/env.d/restic.env >/dev/null <<'EOF'
B2_ACCOUNT_ID=<keyID from privance-restic-prod>
B2_ACCOUNT_KEY=<applicationKey from privance-restic-prod>
RESTIC_REPOSITORY=b2:privance-backups-prod:/restic
RESTIC_PASSWORD_FILE=/run/secrets/restic_password
EOF
echo '<single-line openssl output from Step 2>' | sudo tee /etc/privance/env.d/restic_password >/dev/null
sudo chmod 600 /etc/privance/env.d/restic.env /etc/privance/env.d/restic_password
sudo chown <deploy-user>:<deploy-user> /etc/privance/env.d/restic.env /etc/privance/env.d/restic_password
sudo stat -c "%a %U %G %n" /etc/privance/env.d/restic.env /etc/privance/env.d/restic_password
# Expected: two lines, each starting with "600 <deploy-user> <deploy-user>"
```

### Step 4: Initialise the restic repository in B2

One-shot; the scheduler never calls `init`.

```sh
RESTIC_DR="docker run --rm --env-file /etc/privance/env.d/restic.env -v /etc/privance/env.d/restic_password:/run/secrets/restic_password:ro restic/restic:0.18.1"

$RESTIC_DR init
# Expected: "created restic repository <repo-id> at b2:privance-backups-prod:/restic"
$RESTIC_DR snapshots
# Expected: header "ID  Time  Host  Tags  Paths  Size", no data rows, exit 0
$RESTIC_DR init
# Expected: non-zero exit, stderr contains "config file already exists"
```

### Step 5: Bring up the long-running scheduler

```sh
docker compose -f compose.prod.yaml build restic-runner
docker compose -f compose.prod.yaml up -d restic-runner
docker compose -f compose.prod.yaml ps restic-runner
# Expected: infra-restic-runner-1 State running, command `crond -f -l 8`
```

Cron runs `backup.sh` nightly at 03:30 UTC and `check.sh` Sundays at 04:00 UTC. On-demand:

```sh
docker compose -f compose.prod.yaml run --rm restic-runner /usr/local/bin/backup.sh
```

### Step 6: Daily log-inspection habit

```sh
docker compose -f compose.prod.yaml logs --tail=40 restic-runner
```

Healthy: daily `backup succeeded` + `forget+prune succeeded` + `nightly run complete`; weekly `restic check succeeded`.

Problem signals:
- `BACKUP FAILED with exit code N`: re-run on-demand and read the error. Common causes: stale B2 key in `restic.env`, postgres unhealthy at run time, B2 quota.
- `RESTIC CHECK FAILED`: re-run `check.sh` to confirm before assuming corruption.
- No log entries at 03:30 UTC: cron wedged; `docker compose restart restic-runner`.

Skim weekly.

### Step 7: Restore drill (in-place verification)

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
  restic dump latest /privance.dump | PGPASSWORD="$PGPASS" pg_restore \
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

```sh
echo 'INVITE_REQUIRED=true' >> /etc/privance/env.d/server.env
docker compose -f infra/compose.prod.yaml restart server
docker compose -f infra/compose.prod.yaml logs --tail=20 server
```

Any value other than the string `"true"` keeps signup open.

### Step 2: Mint an invite token

```sh
docker compose -f infra/compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops
```

Expected, in order: one JSON pino log line with `"tokenId":"..."` and `"createdBy":"ops"` (NOT the plaintext), then one plaintext line (43 base64url characters, no `=` padding). Exit 0.

With expiry:

```sh
docker compose -f infra/compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops --expires-in 30d
```

Duration suffix: `d`, `h`, `m`. The log line includes `"expiresAt":"<iso-timestamp>"`.

Note: if signup fails AFTER an invite token is claimed (rare: HIBP outage, unique-username race, Argon2id failure), the token is permanently consumed and the inviter must mint a fresh one.

### Step 3: Safe handoff to the invitee

Send via a single-use ephemeral channel (Signal disappearing messages, encrypted email, in-person). The DB stores only a hash; once terminal scrollback is cleared, the plaintext is unrecoverable.

### Step 4: Verify mint and claim against the database

```sh
docker compose -f infra/compose.prod.yaml exec postgres psql -U privance -d privance
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

Sign up at `https://privance.app` in a real browser using a freshly minted plaintext token. Account is created; `invite_tokens.used_at` and `used_by_user_id` populate; `audit_events` contains `signup_succeeded` for the new user.

## Updating an existing deployment

Once the VPS is bootstrapped, shipping a new version is rsync the source and bundle, rebuild the server image on the VPS, run pending migrations, recreate the server container. Caddy needs no restart because `apps/web/out/` is a read-only bind mount.

From the repo root on your workstation:

```sh
HOST=<vps-ssh-alias>

pnpm -F @privance/web build

rsync -avz --delete apps/web/out/ $HOST:~/privance/apps/web/out/

rsync -avz --delete \
  --exclude=node_modules --exclude=.next --exclude=out \
  --exclude=test-results --exclude=playwright-report --exclude=coverage \
  --exclude=apps/web/ios --exclude=apps/web/android \
  --exclude=.git --exclude=secrets --exclude=.planning --exclude=.turbo \
  ./ $HOST:~/privance/

ssh $HOST 'cd ~/privance/infra && \
  docker compose -f compose.prod.yaml build server && \
  docker compose -f compose.prod.yaml up -d --no-deps server-migrate && \
  docker compose -f compose.prod.yaml up -d --force-recreate --no-deps server'
```

Verify from your workstation:

```sh
curl -fsS https://privance.app/api/health
# Expected: {"ok":true,...}

curl -sI https://privance.app/ | awk -F': ' 'tolower($1)=="last-modified"'
# Expected: last-modified within the last few minutes
```

The `server-migrate` job is a no-op when no new migrations are pending and exits cleanly. Schema changes that follow the expand-backfill-contract pattern can be shipped this way without downtime; single-deploy destructive migrations are not safe and must be split across two deploys.
