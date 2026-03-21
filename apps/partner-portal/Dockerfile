FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/partner-portal/package.json ./apps/partner-portal/
RUN npm install --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared-types ./packages/shared-types
RUN npm run build -w packages/shared-types
COPY apps/partner-portal ./apps/partner-portal
ARG NEXT_PUBLIC_API_URL=https://bx-gateway.fly.dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/partner-portal

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/apps/partner-portal/.next ./apps/partner-portal/.next
COPY --from=builder /app/apps/partner-portal/package.json ./apps/partner-portal/package.json
COPY --from=builder /app/apps/partner-portal/next.config.js ./apps/partner-portal/next.config.js
WORKDIR /app/apps/partner-portal
EXPOSE 3100
CMD ["/app/node_modules/.bin/next", "start", "-p", "3100"]
