# deps: install workspace dependencies
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS deps
WORKDIR /build
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --shamefully-hoist

# builder: produce Next.js static export
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder
WORKDIR /build
RUN corepack enable
COPY --from=deps /build/node_modules ./node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/ ./packages/core/
COPY apps/web/ ./apps/web/
# Version is injected from the git tag by the release workflow (single source of
# truth); next.config falls back to package.json when the arg is absent (dev).
ARG NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
# CI=true: pnpm 11 detects the hoisted node_modules layout in a non-TTY
# container and aborts asking for confirmation to recreate it; CI mode proceeds.
RUN CI=true pnpm -F @privance/web build

# runner: Caddy serving the static export
FROM caddy:2-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /build/apps/web/out /srv/web
EXPOSE 80 443
