# deps: install workspace dependencies
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS deps
WORKDIR /build
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json ./packages/core/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --shamefully-hoist

# builder: compile server bundle
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/ ./packages/core/
COPY server/ ./server/
WORKDIR /build/server
RUN bun build src/index.ts --target=bun --outfile=dist/server.js
RUN bun build scripts/mint-invite.ts --target=bun --outfile=dist/mint-invite.js

# runner: minimal production image
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runner
RUN addgroup -g 10001 -S privance && adduser -u 10001 -S privance -G privance
WORKDIR /app
RUN chown privance:privance /app
COPY --from=builder --chown=privance:privance /build/server/dist/server.js ./dist/server.js
COPY --from=builder --chown=privance:privance /build/server/dist/mint-invite.js ./dist/mint-invite.js
COPY --from=builder --chown=privance:privance /build/node_modules ./node_modules
COPY --from=builder --chown=privance:privance /build/server/drizzle ./drizzle
COPY --from=builder --chown=privance:privance /build/server/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=privance:privance /build/server/package.json ./package.json
USER privance
EXPOSE 3000
CMD ["bun", "dist/server.js"]
