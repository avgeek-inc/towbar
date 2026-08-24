# Towbar API

Hono API for Towbar identity, integrations, Source reconciliation, inventory,
deployments, and signed worker callbacks.

The public listener uses port `4020`. Signed worker routes are mounted only on
the separate container-network listener at port `4023`; Compose does not
publish that port to the host.

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
image exposes the compiled migration command:

```sh
node dist/cli/migrate.js
```

An empty installation exposes a one-time owner setup operation through the web
app's `/login` screen. The transaction is serialized and setup locks after the
first account exists. Login and setup create the API session directly; there is
no authorization-code exchange or separate authentication origin.

Forgotten-owner recovery is an operator-only startup operation. Configure
`TOWBAR_OWNER_RESET_EMAIL` and a high-entropy temporary
`TOWBAR_OWNER_RESET_PASSWORD`, restart the API, sign in normally, and change the
password in Settings. The API stores only a keyed fingerprint of the recovery
value, revokes existing sessions, and refuses to reapply the same value on a
later restart. Towbar exposes no unauthenticated password-reset route.

Signed GitHub push webhooks synchronize only the manifest's configured branch.
After any successful Source sync, including an operator-requested sync, the API
admits apps and Resources with automatic deployment enabled when they are
missing or their effective deployment digest changed. This lets `Sync now`
recover deployables that were previously ineligible because their Server was
not prepared, and retry deployables that failed during an earlier sync. Active
requests and current releases remain deduplicated. The digest covers
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

Server preparation is a durable, Source-scoped operation. Readiness is bound
to the exact normalized Server configuration digest; a manifest change makes
the Server pending again. Deployment admission and automatic-deployment
selection both require a current successful preparation.

App and Resource lifecycle is manifest-owned. A deployable missing from the
latest successful Source sync is archived; the same manifest ID reappearing
restores it. Towbar has no independent decommission action or lifecycle flag.

Runtime actions, database backups, and scoped orphan cleanup are admitted as
immutable asynchronous operations. Cleanup requires an administrator. Towbar
does not expose a database restore operation. A recurring Temporal maintenance workflow asks the API to
queue read-only server reconciliation and due manifest-declared cron backups.

[Applications](../README.md) · [Repository](../../README.md)
