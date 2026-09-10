# Manifest v2 implementation

Status: in progress. Release as 2.0.0 after review and merge; do not publish during implementation.

## Contract

- `towbar.yml` declares version 2 and named environments. Branch mappings live in Towbar, not Git.
- Discover one entity per `*.app.yml` in `.towbar/apps/` and `*.resource.yml` in `.towbar/resources/`, recursively.
- Entity files contain shared settings, required secrets, and explicit environment overrides. Objects merge; arrays replace. Identity and resource type cannot be overridden.
- Repository-level Sources own logical entities. Environment instances own configuration, servers, operations, volumes, backups, secrets, and monitoring.
- Servers have stable workspace-unique slugs referenced in manifests.
- Root environment preview eligibility and app opt-in must both be enabled. PRs never reconcile persistent configuration or secret slots.
- Required secret declarations reconcile per instance: add unset slots, preserve existing values/references, remove deleted declarations. Missing secrets block deployment, not sync. Preserve empty versus unset.
- No permanent v1 compatibility or user-data migration is required. Do not reset production data as part of implementation.

## Connection and sync

- Select repository and discovery branch, inspect environments, map branches, connect and initially sync without deploying.
- Explicit Add environment connects a discovered environment. Git declarations alone do not activate it.
- Each sync reads only the mapped branch at an immutable commit and resolves the selected environment.
- Validate the complete environment before atomic reconciliation. Failed fetches, missing branches/directories, and invalid declarations preserve previous configuration and secrets.
- Sync all reports independent environment outcomes. Enforce workspace domain ownership across commits.
- Mapping changes invalidate older jobs. Serialize instance reconciliation and prevent stale jobs from overwriting current state.
- Removed entities/environments stop automatic operations but do not implicitly destroy workload data.
- UI shows configuration sync separately from deployment readiness; environment selection survives permalinks and browser navigation.

## Delivery checklist

- [ ] Core v2 schemas, file discovery, overrides, secret declarations, deterministic resolved configuration.
- [ ] Repository/environment/logical-entity/instance schema and server slugs.
- [ ] GitHub discovery and immutable file loading; API connection and environment mapping endpoints.
- [ ] Environment-specific atomic sync, stale-job guards, webhooks, initial sync without deployment.
- [ ] Secret reconciliation and validation in Form/File modes, bulk reveal, shared references and deployment admission.
- [ ] App/resource deployment, resource operations/backups, monitoring and vulnerability scope.
- [ ] Preview mapping, PR configuration isolation, hostname and secret scope, cleanup.
- [ ] Source connection/review and environment UI; entity pages, filters, permalinks.
- [ ] API/MCP contracts and generated docs.
- [ ] Fixtures, examples, screenshots, user documentation and release notes.
- [ ] End-to-end Production/Staging app/database and PR preview proof; failed-sync/secret-isolation checks.
- [ ] Full local verification, PR, remote CI. Publish 2.0.0 only after merge.

## Implementation checkpoint

The implementation branch is `feat/manifest-v2-environments` in the main checkout.

Implemented foundations:

- `manifest-v2.ts`: v2 root validation, fixed-path discovery, one-entity files, explicit membership, recursive overrides, server slug validation, required-secret declarations, deterministic per-environment digests.
- `environment-snapshot.ts`: immutable GitHub tree/blob loading, bounded requests/file sizes, rejects truncated trees, symbolic links and partial fetches.
- Schema and migration 0051: environment mappings/revisions, logical entities, instance links, server slugs, named secret scopes.
- `environments.ts` and source-environment routes: connect, list, edit branch with revision checks, disconnect and queue per-environment sync. Mutation routes enforce workspace-owner access.
- `environment-sync.ts` and materialization: transactional environment reconciliation, workspace domain locking, mapping-revision/stale-sync checks, instance identity, missing-directory preservation, secret reconciliation.
- Secret store rejects cross-instance environment access and undeclared key edits for v2 instances; metadata exposes missing versus set keys.

Verified: 14 core tests, 5 GitHub loader tests, and a real PostgreSQL integration suite with 5 subtests (6 reported tests). The database suite proves distinct instances sharing logical identity, unset slots, environment secret isolation, preservation/removal semantics, failed-sync rollback and stale-mapping rejection.

The work is not feature-complete. Important next steps:

1. Complete server slug create/edit UI and API. Tighten nullable schema scaffolding after converting all fixtures/callers; add source-ownership composite FKs. Source still has legacy branch fields/index and the old parser/sync remains temporarily reachable. Remove these rather than ship a permanent v1 compatibility path.
2. Implement repository discovery/review and atomic repository-level connection; connect the SourceCreate UI and environment overview/actions. Add sync-all orchestration and mapped-branch webhooks.
3. Automatic deployments currently skip initial v2 sync, but the rest of scheduling/admission still assumes Source-level commit and production/preview runtime kind. Replace these assumptions with environment state and validate required secrets before queuing. Resume/deferred operations must also be scoped.
4. Preview services still use the old manifest fetch and source branch model. Switch to v2 snapshots, mapped environment eligibility and `preview:<environment>` secret scopes; never reconcile persistent slots from PRs.
5. Named secret scopes are present in storage; execution inheritance, API resource restrictions, shared-secret filtering, and Form/File UI still need completion. The deployment-history query in apps/secrets.ts still maps named scopes to legacy runtime kind and must be replaced during deployment model work.
6. Complete logical-entity UI, instance-aware routes/filters/API/MCP, resource operations, monitoring/alerts/scanning labels, examples/docs/screenshots and v2-only schema generation.
7. Extend integration proof for newer-sync ordering, concurrent domain conflicts, concurrent mapping edits, missing directories, auto-deploy readiness, stage isolation, previews and resource state. Run full verification and remote CI before handing off a PR.

Local dedicated database: Docker container `towbar-v2-tests`, PostgreSQL exposed on 127.0.0.1:32768, database `towbar_v2_test`, disposable test user/password `towbar_test`. Run `environment-sync.integration.test.ts` with `TOWBAR_TEST_DATABASE_URL` pointing there. Production and existing previews were not reset. Migration 0051 required dropping/recreating the managed-secret stage check around the enum-to-text conversion; this was verified on the test database.
