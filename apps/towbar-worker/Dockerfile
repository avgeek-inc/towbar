# syntax=docker/dockerfile:1.7
FROM golang:1.26.4-bookworm AS monitoring-builder
WORKDIR /agent
COPY apps/towbar-monitoring-agent/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/towbar-monitoring-linux-amd64 . \
  && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /out/towbar-monitoring-linux-arm64 .

FROM node:24-bookworm-slim AS base

FROM base AS pruner
ARG TURBO_VERSION=2.10.11
WORKDIR /repo
RUN npm install --global turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune towbar-worker --docker

FROM base AS installer
WORKDIR /repo
RUN corepack enable pnpm
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=towbar-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --store-dir /pnpm/store --frozen-lockfile --config.blockExoticSubdeps=false

FROM installer AS builder
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter towbar-worker build
RUN --mount=type=cache,id=towbar-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm --filter towbar-worker --prod --ignore-scripts \
    --config.blockExoticSubdeps=false deploy --legacy --offline \
    --store-dir /pnpm/store /prod/towbar-worker

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production WORKER_HEALTH_PORT=4030
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssh-client tar \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /prod/towbar-worker ./
COPY --from=builder --chown=node:node /repo/apps/towbar-worker/dist ./dist
COPY --from=monitoring-builder --chown=node:node /out/ /app/monitoring-agent/
ENV TOWBAR_MONITORING_BINARY_DIR=/app/monitoring-agent
USER node
EXPOSE 4030
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:${WORKER_HEALTH_PORT}/health >/dev/null || exit 1
CMD ["node", "dist/worker.js"]
