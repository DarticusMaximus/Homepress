# Multi-stage build for the worker (esbuild CJS bundle).
# Build context MUST be the repo root (pnpm workspace): the worker imports @newsletter/shared.
#   podman build -t newsletter-worker -f worker/Dockerfile .
#
# APPWRITE_API_KEY is runtime-only and NEVER a build input.

# ---------- deps ----------
FROM node:22-alpine@sha256:d51cff3fa44ab8a368ae8708ae974480165be1b699b19527b7c0d2523433b271 AS deps
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY shared/package.json ./shared/
COPY worker/package.json ./worker/
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:22-alpine@sha256:d51cff3fa44ab8a368ae8708ae974480165be1b699b19527b7c0d2523433b271 AS builder
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

# esbuild bundles workspace code; several deps stay external (see worker package.json
# build script) because jsdom needs on-disk companion files (xhr-sync-worker.js).
RUN pnpm --filter worker build
# Pruned production install for those externals (no workspace source / no pnpm CLI).
RUN pnpm --filter worker deploy --prod --legacy /app/deploy

# ---------- runner ----------
# Bundle + production node_modules for esbuild externals. No pnpm, no workspace source.
FROM node:22-alpine@sha256:d51cff3fa44ab8a368ae8708ae974480165be1b699b19527b7c0d2523433b271 AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/deploy/ ./
COPY --from=builder /app/worker/dist ./dist

# Run as the non-root node user (uid 1000) provided by node:22-alpine.
RUN chown -R node:node /app
USER node

CMD ["node", "dist/index.js"]
