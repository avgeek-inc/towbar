# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
FROM base AS pruner
ARG TURBO_VERSION=2.10.11
WORKDIR /repo
RUN npm install --global turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune towbar-web-app --docker
FROM base AS installer
WORKDIR /repo
RUN apk add --no-cache libc6-compat && corepack enable pnpm
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=towbar-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --store-dir /pnpm/store --frozen-lockfile --config.blockExoticSubdeps=false
FROM installer AS builder
ARG NEXT_PUBLIC_TOWBAR_API_BASE_URL=http://localhost:4020
ARG NEXT_PUBLIC_TOWBAR_WEBSITE_BASE_URL=https://towbar.dev
ARG SOURCE_COMMIT=development
ENV NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_TOWBAR_API_BASE_URL=${NEXT_PUBLIC_TOWBAR_API_BASE_URL} \
  NEXT_PUBLIC_TOWBAR_WEBSITE_BASE_URL=${NEXT_PUBLIC_TOWBAR_WEBSITE_BASE_URL} \
  SENTRY_ALLOW_MISSING=true SOURCE_COMMIT=${SOURCE_COMMIT}
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter towbar-web-app build
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=4021
RUN apk add --no-cache ca-certificates curl \
  && addgroup --system --gid 1001 towbar \
  && adduser --system --uid 1001 --ingroup towbar towbar
COPY --from=builder --chown=towbar:towbar /repo/apps/towbar-web-app/.next/standalone ./
COPY --from=builder --chown=towbar:towbar /repo/apps/towbar-web-app/.next/static ./apps/towbar-web-app/.next/static
COPY --from=builder --chown=towbar:towbar /repo/apps/towbar-web-app/public ./apps/towbar-web-app/public
USER towbar
EXPOSE 4021
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:${PORT}/health >/dev/null || exit 1
CMD ["node", "apps/towbar-web-app/server.js"]
