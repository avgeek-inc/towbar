# syntax=docker/dockerfile:1.7
FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS monitoring-builder
WORKDIR /agent
COPY apps/towbar-monitoring-agent/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/towbar-monitoring-linux-amd64 . \
  && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/towbar-monitoring-linux-arm64 .

FROM node:24-trixie-slim@sha256:6950b66b4c0cb0151ce89fa75074673850763d096b044f422c6729b588dd4956 AS base

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

FROM cgr.dev/chainguard/wolfi-base@sha256:1d95114038f76513a9ace6fca107d5582b08c65981f81f61cb56bf7fd2ef216d AS runner
WORKDIR /app
ENV NODE_ENV=production WORKER_HEALTH_PORT=4030
RUN apk add --no-cache \
  ca-certificates=20260611-r1 \
  curl=8.22.0-r2 \
  nodejs-24-minimal=24.21.0-r1 \
  nodejs-24-minimal-compat=24.21.0-r1 \
  openssh-client=10.5_p1-r1
COPY --from=builder --chown=65532:65532 /prod/towbar-worker ./
COPY --from=builder --chown=65532:65532 /repo/apps/towbar-worker/dist ./dist
COPY --from=monitoring-builder --chown=65532:65532 /out/ /app/monitoring-agent/
ENV TOWBAR_MONITORING_BINARY_DIR=/app/monitoring-agent
USER 65532:65532
EXPOSE 4030
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:${WORKER_HEALTH_PORT}/health >/dev/null || exit 1
CMD ["node", "dist/worker.js"]
