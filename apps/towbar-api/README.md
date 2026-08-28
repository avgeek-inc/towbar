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

Relevant pull request events for Apps with Preview enabled enter a Source/PR
coalescing workflow. The API reads the pull request's current state before each
reconciliation, so delayed or out-of-order webhooks cannot recreate a closed
Preview. Admission records independent Preview deployments and releases,
publishes GitHub Deployment statuses, updates one aggregate Preview comment on
the pull request, and keeps production runtime health unchanged. Pull request
merge or closure, retargeting, TTL expiry, manifest disablement, and owner
deletion converge on the same cleanup admission path.

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

Manual App and Resource deployments admit the latest successfully synchronized
revision without synchronizing the Source again. This keeps redeploy admission
fast and lets a redeploy consume newly updated AWS Secrets Manager values,
which are resolved just in time by the worker. Use `Sync now` for repository or
manifest changes; signed GitHub webhooks keep the configured branch current.

Owners can inspect key names and edit values for JSON environment bundles
already attached to an App or Resource. Resources expose deployment bindings
only; build bindings apply only to Apps. The API performs the read/merge/write
operation against AWS Secrets Manager with an expected-version check; responses
contain only key names and version metadata. References remain manifest-owned
and secret values are never persisted in PostgreSQL.

Declared Docker networks are created as managed bridge networks on first use
and reused by subsequent apps and Resources on that Server. Operators do not
need to pre-create manifest-owned networks.

Server preparation is a durable, Source-scoped operation. Readiness is bound
to the exact normalized Server configuration digest; a manifest change makes
the Server pending again. Deployment admission and automatic-deployment
selection both require a current successful preparation.

Server check history is retained as a rolling window of the newest 500 checks
per Server. Older completed checks are removed as checks finish, while queued
and running checks are preserved until they reach a terminal state.

App and Resource lifecycle is manifest-owned. A deployable missing from the
latest successful Source sync is archived; the same manifest ID reappearing
restores it. Towbar has no independent decommission action or lifecycle flag.

Runtime actions, database backups, and scoped orphan cleanup are admitted as
immutable asynchronous operations. Cleanup requires an administrator. Towbar
does not expose a database restore operation. A recurring Temporal maintenance workflow asks the API to
queue read-only server reconciliation and due manifest-declared cron backups.

[Applications](../README.md) · [Repository](../../README.md)
