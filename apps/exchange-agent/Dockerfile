FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ── Install all workspace dependencies ──────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/logger/package.json       ./packages/logger/
COPY packages/database/package.json     ./packages/database/
COPY packages/a2a-sdk/package.json      ./packages/a2a-sdk/
COPY apps/exchange-agent/package.json   ./apps/exchange-agent/
RUN npm install --legacy-peer-deps

# ── Build shared packages then the app ──────────────────────────────────────
FROM deps AS builder
COPY packages/shared-types/src         ./packages/shared-types/src
COPY packages/shared-types/tsconfig.json ./packages/shared-types/tsconfig.json
RUN npm run build -w packages/shared-types

COPY packages/logger/src               ./packages/logger/src
COPY packages/logger/tsconfig.json     ./packages/logger/tsconfig.json
RUN npm run build -w packages/logger

COPY packages/shared-utils/src         ./packages/shared-utils/src
COPY packages/shared-utils/tsconfig.json ./packages/shared-utils/tsconfig.json
RUN npm run build -w packages/shared-utils

COPY packages/database/src             ./packages/database/src
COPY packages/database/tsconfig.json   ./packages/database/tsconfig.json
RUN npm run build -w packages/database

COPY packages/a2a-sdk/src              ./packages/a2a-sdk/src
COPY packages/a2a-sdk/tsconfig.json    ./packages/a2a-sdk/tsconfig.json
RUN npm run build -w packages/a2a-sdk

COPY apps/exchange-agent/src           ./apps/exchange-agent/src
COPY apps/exchange-agent/tsconfig.json ./apps/exchange-agent/tsconfig.json
RUN npm run build -w apps/exchange-agent

# ── Lean production image ────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy node_modules (workspace symlinks point to /app/packages/*)
COPY --from=builder /app/node_modules ./node_modules
# Copy shared packages with their dist output (symlink targets)
COPY --from=builder /app/packages ./packages
# Copy service dist
COPY --from=builder /app/apps/exchange-agent/dist ./apps/exchange-agent/dist
EXPOSE 3008
CMD ["node", "apps/exchange-agent/dist/index.js"]
