# Towbar Core

Manifest, reconciliation, deployment-state, and Temporal naming contracts used
by Towbar services. This package contains deterministic domain logic only; it
does not perform network, filesystem, database, or secret-provider I/O.

```sh
pnpm --filter @workspace/towbar-core test
pnpm --filter @workspace/towbar-core lint
pnpm --filter @workspace/towbar-core typecheck
pnpm --filter @workspace/towbar-core build
```

Towbar v2 declares environments in `towbar.yml` and entities in
`.towbar/apps/**/*.app.yml` and `.towbar/resources/**/*.resource.yml`.
Branch mappings belong to the control plane. Entities reference workspace
servers by slug, with separate instances and secrets for each environment.

The public schemas are generated from the validation contracts with
`pnpm --filter @workspace/towbar-core schemas`. Tests check that the committed
schemas remain current. The repository parser resolves one environment at an
immutable commit, validates merged defaults and overrides, and returns required
secret declarations separately from runtime configuration. Version 1 is rejected.

Preview-enabled environments admit same-repository PRs targeting their mapped
branches. Apps must also opt in. Preview values are isolated from persistent
environments; secret values never enter repository snapshots.

Towbar hashes the path, Git mode, object type, and object SHA of every matched
file. That source-input digest is combined with runtime and server configuration
to decide whether an automatic deployment is needed. Scheduling-only fields
such as `autoDeploy`, `deploymentInputs`, and `sourceBranch` do not change the
runtime digest. A truncated Git tree falls back to commit-sensitive deployment
rather than risking a false skip.

`resources` declares first-class `image`, `postgres`, and `redis` deployables.
They share stable IDs, queueing, deployments, releases, and Source deletion
with Apps. Resource images require an explicit non-`latest` tag or
digest. PostgreSQL and Redis add bounded defaults, built-in health checks, and
persistent logical volumes.

Resources attached to an explicit Docker network receive a stable private
`container.networkAlias`, defaulting to the Resource ID. Optional
`access.sshTunnel.hostPort` publishes the Resource port only on the server's
loopback interface for operator tools reached through SSH. Alias claims are
unique per server and Docker network; tunnel ports are unique per server within
one manifest, with host-wide conflicts rejected again during deployment.

PostgreSQL and Redis Resources may declare S3, GCS, and Azure Blob backup destinations,
retention, and an optional five-field UTC cron schedule that runs no more than
hourly. Workspace cloud integrations supply credentials, and a multi-provider
policy selects `restoreFrom` for new recovery points. Runtime-operation, health/drift, and Source-owned orphan contracts are
shared here so the API, worker, deployer, and web client use the same bounded
vocabulary.

[Packages](../README.md) · [Repository](../../README.md)
