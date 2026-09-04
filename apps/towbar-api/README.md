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
password in Settings. The API stores the login credential only as an Argon2id
password hash. A separate keyed marker records only whether that operator reset
value has already run; it is never accepted by login. Existing sessions are
revoked, and the same reset value is not reapplied on a later restart. Towbar
exposes no unauthenticated password-reset route.

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

The same eligible pull request reconciliation creates an immutable deployment
plan before Preview admission. Planning reads the PR head manifest, current
Source inventory, repository input digests, server observations, credential
metadata, and active operation state without resolving secret values or
enqueueing work. The API publishes one completed GitHub Check per Source and
head commit and links it to the full plan. Repeated deliveries update the
existing Check and reuse the same plan record and Preview deployment work for
that Source, pull request, and head commit.
Pull requests with no matching deployable changes produce a neutral `skipped`
plan without evaluating unrelated server capacity, readiness, or secret
bindings. Transient GitHub transport, rate-limit, and availability failures are
retried instead of being persisted as blocked plans. GitHub Check reporting is
tracked independently and cannot change or invalidate a persisted plan.

Optional S3 backup credentials and Servers are Source-scoped. Server identity is
`(source_id, canonical_ip)`, allowing independent Sources to target the same IP
without sharing configuration or trust records. Deleting a Source permanently
removes its database-owned credential, inventory, backup metadata, runtime
state, and operational history. Backup objects already uploaded to S3 remain
external and are not deleted by Source removal.

Apps and Resources share the deployment ledger but remain separate API and UI
entities. Resources support versioned images plus PostgreSQL and Redis presets.
Editor-owned secrets are stored separately from immutable deployable snapshots.
Source production defaults and app overrides are resolved at execution time;
preview stages use only app preview values.
Successful release commits also persist the Docker image content digest and
platform reported by the target host. Existing source, manifest, configuration,
and selected-input digests remain the rest of the provenance record.

Manual App and Resource deployments admit the latest successfully synchronized
revision without synchronizing the Source again. This keeps redeploy admission
fast and lets a redeploy consume current Towbar-managed secrets, resolved
consistently by the API over the authenticated internal execution path. Use `Sync now` for repository or
manifest changes; signed GitHub webhooks keep the configured branch current.
Owners can pause new automatic deployments for an entire Source or one App or
Resource. Paused revisions remain eligible for reconciliation after the pause
is removed; manual deployments remain available while automatic admission is
paused.

Owners can add, replace, and delete variables from an empty configuration.
Resources inherit runtime defaults only; apps support build, runtime, and both
hook stages. Values are encrypted with AES-256-GCM in PostgreSQL. Mutations
require an expected revision, and all public responses are write-only metadata.
See [Managed secrets](../../docs/docs/managed-secrets.md) for API, cutover, and recovery.

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
immutable asynchronous operations. Cleanup requires an administrator. Managed
database restores require owner confirmation and a reason, revalidate the
selected retained object, and expose an append-only progress trail. A recurring
Temporal maintenance workflow asks the API to queue read-only server
reconciliation, due manifest-declared cron backups, backup assurance checks,
and expired rollback-volume cleanup.

Owners can configure multiple Source-scoped Slack and SMTP notification
destinations for deployment, Preview, runtime health, backup, and restore event
categories. Owners configure Slack and SMTP in installation Settings, with
credentials encrypted in the database. Each attempt resolves current provider
configuration and records a separate durable delivery and bounded retry history.
Test sends and manual retries use the same delivery pipeline. Slack uses a bot
token and channel IDs. SMTP targets must resolve exclusively to public addresses
and are connected through a pinned address with TLS server-name verification.

[Applications](../README.md) · [Repository](../../README.md)
