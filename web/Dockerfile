# Multi-stage build for the Next.js (standalone) web app.
# Build context MUST be the repo root (pnpm workspace): web imports @newsletter/shared.
#   podman build -t homepress-web -f web/Dockerfile .
#
# NEXT_PUBLIC_APPWRITE_* and secrets are runtime-only (env_file / container env).
# Do not pass them as build args — prebuilt GHCR images must work with any .env.
#
# Base digest is the node:22-alpine *manifest list* (multi-arch), not a single-arch
# image digest. Pinning an arm64-only digest breaks GitHub Actions (linux/amd64).

# ---------- deps ----------
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY shared/package.json ./shared/
COPY worker/package.json ./worker/
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

# Bring in the installed node_modules (pnpm's symlinked virtual store is preserved).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/worker/node_modules ./worker/node_modules

# Workspace source.
COPY shared ./shared
COPY web ./web
COPY worker ./worker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Build without NEXT_PUBLIC_* so values are not inlined; runtime env supplies them.
RUN pnpm --filter web build

# ---------- runner ----------
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone server (bundles its own deps). Layout: /app/web/server.js
COPY --from=builder /app/web/.next/standalone ./
# Static assets must sit next to the standalone web dir so CSS/JS resolve.
COPY --from=builder /app/web/.next/static ./web/.next/static

# Run as the non-root node user (uid 1000) provided by node:22-alpine.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "web/server.js"]
