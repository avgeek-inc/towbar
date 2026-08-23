# Towbar API

Hono API for Towbar identity, integrations, Source reconciliation, inventory,
deployments, and signed worker callbacks.

```sh
pnpm --filter @workspace/towbar-core build
pnpm --filter @workspace/towbar-database build
pnpm --filter towbar-api dev
pnpm --filter towbar-api test
pnpm --filter towbar-api lint
pnpm --filter towbar-api typecheck
pnpm --filter towbar-api build
```

Production uses separate runtime and migrator PostgreSQL credentials. GitHub
App credentials, the internal HMAC key, and `TOWBAR_CREDENTIALS_KEY` are host
secrets and must never be stored in PostgreSQL or committed. The production
image exposes compiled, dependency-complete operator commands:

```sh
node dist/cli/migrate.js
node dist/cli/bootstrap-owner.js
node dist/cli/issue-recovery-token.js
```

Signed GitHub push webhooks synchronize only the manifest's configured branch.
After a successful push sync, the API admits apps with automatic deployment
enabled only when their effective deployment digest changed. The digest covers
the selected Git tree inputs, runtime configuration, and target server
configuration. Plain `autoDeploy: true` remains compatible and treats every
commit as changed; `autoDeploy.inputs` enables path-aware selection. A repeated
request for a queued or active digest is deduplicated. A newer, different digest
marks an older same-app request `skipped` only while the older request is still
queued.

AWS credentials and Servers are Source-scoped. Server identity is
`(source_id, canonical_ip)`, allowing independent Sources to target the same IP
without sharing configuration or trust records. Deleting a Source permanently
removes its database-owned credential, inventory, backup metadata, runtime
state, and operational history. Backup objects already uploaded to S3 remain
external and are not deleted by Source removal.

Apps and Resources share the deployment ledger but remain separate API and UI
entities. Resources support versioned images plus PostgreSQL and Redis presets.
Root shared build/deployment secret references are copied into immutable
deployable snapshots and resolved only at execution time.

App and Resource lifecycle is manifest-owned. A deployable missing from the
latest successful Source sync is archived; the same manifest ID reappearing
restores it. Towbar has no independent decommission action or lifecycle flag.

Runtime actions, database backups, and scoped orphan cleanup are admitted as
immutable asynchronous operations. Cleanup requires an administrator. Towbar
does not expose a database restore operation. A recurring Temporal maintenance workflow asks the API to
queue read-only server reconciliation and due manifest-declared cron backups.

[Applications](../README.md) · [Repository](../../README.md)
