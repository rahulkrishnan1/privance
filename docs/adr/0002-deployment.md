# ADR-0002: Deployment

- **Status:** Accepted
- **Date:** 2026-05-23
- **Amended:** 2026-06-05. Deploys moved from rsync + build-on-VPS to CI-built images pulled from GHCR; the Deploys row, the CI threat-surface consequence, and the push-deploy alternative reflect the amended model.
- **Amended:** 2026-07-23. PWA service worker migrated from hand-rolled `sw.js` to Workbox `injectManifest`; web build migrated from Next.js static export to Vite + TanStack Router static export.

## Context

Privance needs a live, reachable, backed-up instance at `https://privance.app` that a single operator can stand up, run, and maintain. The deployment architecture decisions are separate from the stack decisions in ADR-0001 (Bun + Hono + Vite); this ADR records what runs WHERE and how it gets there.

Constraints that shaped the deployment:

- Single operator, hobby budget. No PagerDuty rotation, no dedicated SRE.
- One small VPS is enough for the foreseeable user count. Vertical scale before horizontal.
- Privacy by construction. The server stores ciphertext only; the deployment must preserve this property end-to-end (no plaintext in logs, no plaintext in backups, no plaintext in any place reachable from a VPS compromise).
- Invite-only signup at launch. Open signup is a separate decision; the deployment must enforce the gate.
- Post-Shai-Hulud supply-chain discipline. No auto-deploy from a CI runner with credentials that can reach production; operator-driven deploys, reviewed locally first.
- TLS via Let's Encrypt, not a custom CA. No hand-rolled cert management.
- DNS through Cloudflare for ergonomics (API + sane web UI), but DNS-only mode (no orange-cloud proxy) to avoid Cloudflare seeing decrypted-on-the-wire-to-the-VPS traffic. The wire is already TLS-terminated by Caddy on the VPS.

## Decision

| Layer | Choice |
| ----- | ------ |
| Host | Single Hetzner Cloud VPS (small shared-vCPU SKU, EU region; current sizing table in `infra/hetzner-vps.md`). |
| OS | Ubuntu LTS. SSH-key-only login as a non-root deploy user; root SSH disabled; firewall open on 22/tcp, 80/tcp, 443/tcp, 443/udp only. |
| Runtime | Docker Compose stack: `server` (Bun, multi-stage Dockerfile, non-root uid 10001, digest-pinned `oven/bun` base) + `postgres` (Postgres 17, loopback-only) + `caddy` + `restic-runner` (cron sidecar). |
| TLS + ingress | Caddy with Let's Encrypt; serves the Vite static export at `/` and reverse-proxies `/api/*` to the server container; HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP all set in `infra/Caddyfile`. |
| DNS | Cloudflare, DNS-only (no proxy / orange cloud). A + AAAA records for apex + `www`. |
| Secrets | `/etc/privance/env.d/` directory mode 700, owned by the deploy user. Postgres password as a Docker secret; restic password + Backblaze B2 keys + `ENUMERATION_SECRET` + `SIGNUP_ALLOWLIST` + `INVITE_REQUIRED` in env-d files mode 600. Nothing in the repo. |
| Migrations | `server-migrate` one-shot Compose service runs `bun run db:migrate` before the API container accepts traffic. Failed migrations halt boot. |
| Signup gating | Invite-only via the `InviteService` module. `INVITE_REQUIRED=true` enforced server-side; operator mints tokens via `docker compose -f compose.prod.yaml exec server bun dist/mint-invite.js` from the deploy directory on the VPS over SSH. Tokens are hashed at rest with SHA-256 and single-use via atomic UPDATE. |
| Backups | Nightly `pg_dump --format=custom` piped to `restic backup --stdin-from-command`, encrypted and stored in Backblaze B2 (EU Central). Retention: 7 daily / 4 weekly / 6 monthly. Weekly structural `restic check`. In-place restore drill required during bring-up. |
| PWA | Workbox `injectManifest` service worker built from `src/sw-src.ts` via `scripts/build-sw.mjs`. Manifest + icons in `public/`, registration via `ServiceWorkerRegistration.tsx`. Cache strategy: revision-based precache for all Vite chunks, network-only for `/api/*`, cache-first for WASM/KDF assets, stale-while-revalidate with offline fallback for navigation. SW activation is deferred to next navigation; `skipWaiting` is only triggered by the client update banner, not on install, to prevent mid-crypto-operation version skew. |
| Deploys | Operator-initiated, image-based: GitHub Actions builds and pushes versioned images to GHCR on `v*` tags; the operator runs `infra/deploy.sh <version>` from the workstation, which makes the VPS pull the pinned images and recreate containers. No CI runner has VPS credentials; CI holds only GHCR `packages: write`. |

## Consequences

**Easier:**

- One operator can fully understand the production surface. Compose file + Caddyfile + env-d directory + restic-runner is the entire moving-parts inventory.
- A compromised CI runner cannot reach production directly: no CI runner has VPS credentials, and every deploy is operator-initiated. CI does hold GHCR `packages: write`, so a compromised runner could publish a tampered image; the mitigations are that deploys pull only operator-chosen version tags (never tracking a moving tag in production), the release workflow runs only repo-owned code on tag pushes, and the operator reviews what a tag contains before pushing it.
- Restore drills are cheap to run because the same compose stack stands up identically on any host.
- TLS auto-renewal is handled by Caddy; the operator never touches certificates manually.
- Backups are restic-encrypted before they leave the VPS, so B2 sees only opaque blobs; even a B2 account compromise reveals no plaintext.

**Harder:**

- Operator-typed deploys still carry fat-finger risk. Mitigation: `infra/deploy.sh` wraps the whole sequence (tag check, release-workflow check, pull, recreate, health check) in one command; the bring-up runbook in `infra/README.md` covers the rest.
- Single VPS has no failover. A Hetzner host outage means downtime until Hetzner recovers or the operator stands up a replacement from backups. Acceptable at current scale; revisit if uptime SLA changes.
- Vertical-only scale ceiling. The small-VPS sizing handles low-hundreds of users; growth past that requires either a bigger box or a small architectural change (separate Postgres, CDN for the static export). Both reversible.

**Locked out of (until reversed):**

- Auto-deploy on merge. Every release is operator-typed. No "merge to main deploys to prod" semantics.
- Multi-region presence. One Hetzner host, one B2 region. EU-resident at present.
- Cloudflare-level WAF / bot protection. DNS-only mode bypasses Cloudflare's proxy features; the only edge protection is what Caddy + the Bun server enforce themselves.

**Reversal cost:**

- Hetzner → another VPS provider (Linode, DigitalOcean, OVH): the entire stack is Compose pulling registry images, so it's a fresh `docker compose up -d` on the new host after restoring Postgres from B2. Hours of operator time, no data migration code.
- Cloudflare → another DNS host: change the registrar's nameservers. Minutes of operator time. No code impact.
- Caddy → another TLS terminator (nginx, Traefik): rewrite the Caddyfile. Hours of operator time; CSP + HSTS + reverse-proxy rules are well-understood patterns in any tool.
- Backblaze B2 → another S3-compatible store (Wasabi, R2, native S3): rewrite the restic repository URL. The restic format is portable. Minutes of operator time + one fresh `restic init`.
- Docker Compose → Kubernetes: this is the expensive reversal. The Compose file maps to manifests cleanly, but the secrets and volume model differs enough that this is a deliberate migration, not a swap.

## Alternatives considered

**Kubernetes on a managed control plane.** Rejected: operational complexity dwarfs the use case. One Compose file is enough; managed k8s adds a control plane, RBAC, ingress controllers, and a per-cluster monthly bill for a single-instance workload.

**Fly.io or Render or Railway as the host.** Rejected: managed platforms ship convenience but introduce a third-party operator with access to TLS-terminated traffic. The whole architectural posture is "the operator is the only entity that sees plaintext at any layer outside the user's browser." A Hetzner VM with SSH access keeps that posture; a platform-as-a-service does not.

**Cloudflare Tunnel + Workers in front of the VPS.** Rejected: Cloudflare would see TLS-terminated traffic. DNS-only mode (current) keeps Cloudflare as a name resolver only, not a man-in-the-middle.

**S3 instead of Backblaze B2 for backups.** Rejected: B2 is cheaper at our restore-only access pattern (free egress for the first 3x of storage per month). The restic format works on either; choosing B2 is purely cost.

**Push-deploy from a CI runner.** Rejected: manual deploys are slower but eliminate the "compromised CI runner pushes malicious code to prod" path. The amended model keeps this boundary: CI builds and publishes images to a registry (deploy-from-tag), but only the operator can make production pull them; CI never gains VPS credentials. If full push-deploy is revisited, it would require deploy-key scoping and a two-person rule for `main` merges.

**A second VPS for warm standby.** Rejected at current scale. The B2 backups + in-place drill mean the recovery point is "last night" and the recovery time is "however long it takes to stand up a new compose stack and restore the latest snapshot." Revisit when user count justifies the second host.
