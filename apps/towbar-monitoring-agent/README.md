# Towbar monitoring agent

A dependency-free Go collector and HTTPS sender for Linux servers. The worker installs the binary and hardened systemd units through the existing trusted SSH connection. Agent credentials never enter Temporal workflow arguments or history.

See [monitoring documentation](../../docs/docs/monitoring.mdx) for operator setup, metrics, limits, and retention.

## Build and test

Use Go 1.26.4, matching CI and the worker Docker build:

```sh
go vet ./...
go test -race ./...
mkdir -p ../../tmp/monitoring-agent
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags='-s -w' -o ../../tmp/monitoring-agent/towbar-monitoring-linux-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -buildvcs=false -trimpath -ldflags='-s -w' -o ../../tmp/monitoring-agent/towbar-monitoring-linux-arm64 .
```

For a local worker, set `TOWBAR_MONITORING_BINARY_DIR` to the absolute path of that output directory. Production worker images include both architectures automatically.

The collector atomically replaces one snapshot in `/run/towbar-monitoring`. The sender owns its persistent, bounded retry queue in `/var/lib/towbar-monitoring`. Separate service users keep the upload credential away from the process that accesses Docker. Systemd unit definitions and idempotent SSH installation/removal are in `packages/towbar-deployer/src/monitoring-agent.ts`.
