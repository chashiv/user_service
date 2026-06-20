# syntax=docker/dockerfile:1.7

# ─── Stage 1: builder ──────────────────────────────────────────────────────────
# Uses the full slim image so npm can fetch prebuilt native binaries
# (better-sqlite3, pg-native fallbacks). Bookworm = glibc → no musl rebuild.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install ALL deps (including dev) for the TS compile.
# Copy lockfile first to maximise layer caching.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# Copy sources and compile.
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# Drop dev deps so we can copy a lean node_modules into the runtime stage.
RUN npm prune --omit=dev


# ─── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# The official node image already provides a non-root "node" user (uid 1000).
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist          ./dist
COPY --chown=node:node package.json                       ./package.json
COPY --chown=node:node docker/healthcheck.js              ./docker/healthcheck.js

# Writable directory for the sqlite fallback driver (won't be touched when using
# postgres). Owned by the non-root user so the app can create files in it.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD node docker/healthcheck.js || exit 1

CMD ["node", "dist/main.js"]
