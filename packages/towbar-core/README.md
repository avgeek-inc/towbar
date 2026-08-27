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

The public deployment schema is stored in
[`schemas/deployment.v1.json`](schemas/deployment.v1.json). Keep the JSON Schema,
Zod schema, fixtures, and parser tests in lockstep.

Sources declare one authoritative `branch` (default `main`). Servers declare
bounded `buildConcurrency` and may use a private `ssh.host` distinct from the
public server `ip`. A successful sync archives declared Servers that are not
referenced by an App or Resource and restores them when a reference reappears.
Apps may opt into `autoDeploy`, declare named root
`deploymentInputs`, select those groups plus repository globs through
`autoDeploy.inputs`, and run image-scoped `preDeploy`/`postDeploy` hooks. Plain
`autoDeploy: true` intentionally treats every Source commit as changed for
backward compatibility. Towbar does not impose deployment ordering between
deployables. Operators who require ordering can disable automatic deployment
for the downstream deployable and admit it manually after its prerequisite.
Normalized snapshots expand input groups and include their security-sensitive
and automatic-deployment configuration.

Towbar hashes the path, Git mode, object type, and object SHA of every matched
file. That source-input digest is combined with runtime and server configuration
to decide whether an automatic deployment is needed. Scheduling-only fields
such as `autoDeploy`, `deploymentInputs`, and `sourceBranch` do not change the
runtime digest. A truncated Git tree falls back to commit-sensitive deployment
rather than risking a false skip.

Root `secrets.build` and `secrets.deployment` arrays declare Source-wide JSON
environment bundles. Apps merge those with their own bundles; app keys override
shared keys, while duplicate keys between shared bundles fail closed.

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

PostgreSQL and Redis Resources may declare Source-scoped S3 backup storage,
retention, and an optional five-field UTC cron schedule that runs no more than
hourly. Runtime-operation, health/drift, and Source-owned orphan contracts are
shared here so the API, worker, deployer, and web client use the same bounded
vocabulary.

[Packages](../README.md) · [Repository](../../README.md)
