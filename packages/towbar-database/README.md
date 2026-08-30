# Towbar Database

PostgreSQL schema, migrations, and typed client for Towbar. PostgreSQL is the
product-facing source of truth; Temporal stores workflow execution history.

```sh
pnpm --filter @workspace/towbar-database build
pnpm --filter @workspace/towbar-database db:generate
DATABASE_TOWBAR_MIGRATOR_URL=postgres://… pnpm --filter @workspace/towbar-database db:migrate
```

Use `DATABASE_TOWBAR_MIGRATOR_URL` for migrations and the least-privilege
`DATABASE_TOWBAR_URL` for service queries. Credential payload columns contain
only authenticated ciphertext envelopes.

The Apps table materializes manifest-owned deployables. `archived_at` records
that an ID is absent from the latest successful Source sync and is cleared if
that ID reappears; there is no separate decommission lifecycle state. Servers
use the same reversible archive state and remain active only while at least one
desired App or Resource references them.

Preview environments are Source/App/Git-ref scoped. Their deployments and
releases carry an explicit environment and never update the production runtime
observation row. Deleted Preview records remain as operational history while
their runtime artifacts are removed durably.

Deployment plans are immutable Source-scoped records keyed by a deterministic
identity digest. They retain current and target commit and manifest identities
plus the serialized comparison. Mutable GitHub Check delivery state lives in a
separate one-to-one table so retries never rewrite the plan itself.

Successful deployments and releases retain the target Docker image's
content-addressed digest and platform. Older records remain readable with
unknown provenance until they are redeployed.

[Packages](../README.md) · [Repository](../../README.md)
