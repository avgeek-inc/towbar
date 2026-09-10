---
title: "Manifest v2 implementation plan"
description: "Delivery requirements and verification checkpoints for environment-scoped configuration."
---

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

## Current implementation

The branch is `feat/manifest-v2-environments` in the main checkout. The checklist
above tracks complete delivery areas, including final integration proof; it is
not a list of untouched work.

- Core: the repository parser resolves immutable v2 root/entity files, validates
  explicit membership and merged overrides, and separates required keys from
  runtime configuration. The production v1 single-file parser and published v1
  schema are removed. Root/app/resource JSON schemas are generated with a drift
  check. Starter files and configuration documentation use v2.
- Storage: environments, mapping revisions, logical entities, instance links,
  required keys and server slugs exist. Composite foreign keys guard instance,
  source, server and workspace ownership. Source-level branch storage and its
  public field are removed; each workspace connects a repository once. App and
  resource entity/environment links, server slugs and instance secret declarations
  are required by PostgreSQL. Deployment secret declarations are also required
  snapshots; execution always checks their required keys. Source commit, digest
  and successful-sync fields are removed; environments own these snapshots.
- Sources: discovery/connect, selected environment subsets, initial sync without
  deployment, explicit add/edit/disconnect/reconnect, per-environment snapshots,
  mapped push routing and sync history are implemented. Immutable GitHub loading
  and atomic reconciliation reject stale mappings and preserve failed-sync data.
- Deployment: admission locks environments before instances, validates required
  secrets, and rejects disconnected/stale targets. Resume scheduling uses each
  environment's own revision. History exposes and filters target environments;
  the underlying deployment kind still uses production/preview terminology.
- Secrets: app/resource reads and writes require mapping identity. Declared keys
  are edited as values, with isolated named and preview scopes. Shared-secret
  choices no longer invent production when there are no connected environments.
- Previews: mapped base-branch eligibility, target and app opt-in, immutable PR
  head resolution, isolated PR declarations, target admission guards and cleanup
  selection are implemented. Lifecycle locking protects reconciliation and
  manual redeploy. Real end-to-end PR execution remains unproven.
- UI: server slugs, Source environment controls, instance environment switching,
  inventory environment filters, deployment history filters and URL navigation
  exist. Inventory still presents instance rows rather than grouping logical
  entities. Deployment chips show the recorded environment name. Monitoring
  entity search and alert/incident identities include environment names; kind
  filters distinguish persistent deployments from previews.
- Fixtures: production/staging sibling app and resource instances and history
  filters exist. Browser checks proved a staging history permalink, opening its
  app instance, switching to production, and Back restoring staging. Per-environment v2 manifest snapshot fixtures are validated through the parser;
  the obsolete source manifest endpoint returns 404. Onboarding and secret
  fixture handlers still need v2 conversion.
- API/MCP: current catalogue has 140 operations and 55 curated tools. Generated
  contracts and owner/read-only boundaries are checked. The MCP integration
  fixture now explicitly connects an environment before editing shared secrets.

## Latest verification

- Monitoring environment labels: the database regression verifies staging-only
  entity search and environment identity on alerts/incidents. All 22 fixture API
  tests pass, including staging monitoring search. API/web typechecks, scoped
  lint and generated documentation checks pass.

- `pnpm verify` passed: docs, formatting, lint, typechecks, standard tests and
  builds. The default test run contains environment-gated skips; this is not
  proof of Docker, Temporal or all database execution.
- Full API suite against the dedicated PostgreSQL database: 228 passed, no skips.
  After the final test-helper refactor, the focused API/MCP database suite also
  passed all nine tests.
- Core: 111 passed. API/worker typechecks pass. Both focused environment and
  secret database suites pass 30 tests combined. Fixture suite: 24 passed.
- Documentation metadata, navigation, redirects and internal links pass for
  180 pages. Published schemas/examples are synchronized.
- HeroUI 3.2.4 imports `@internationalized/date` without declaring it. A scoped
  pnpm package extension fixes the dependency; the brand-rendering test and full
  verification pass with this installed graph.

The disposable database is `towbar_v2_test` on 127.0.0.1:32768, provided by the
`towbar-v2-tests` Docker container. Use `TOWBAR_TEST_DATABASE_URL` for integration
tests. Do not reset the hosted installation or use its database.

## Remaining delivery work

1. Audit persistent/preview deployment labels throughout UI and generated docs.
   Deployment records now preserve a required target environment snapshot with
   ID, name, branch and mapping revision; history filters use that snapshot.
2. Audit resource operations, backups/restores, monitoring, alerts and scanning
   for instance/environment scope and labels. Validate that resource secret
   stage declarations match stages the resource editor and execution support.
3. Complete logical-entity inventory presentation and verify all environment
   controls, readiness, validation failures and permalinks in rendered pages.
4. Convert remaining fixture handlers for connection/discovery, declared secrets
   and complete per-environment manifest configuration fidelity.
   Exercise Form/File editing, reveal, missing/empty values and branch changes.
5. Prove complete local production/staging app/database and PR workflows,
   including failure isolation, stale jobs, cleanup, resource data separation and
   worker execution. Run relevant Docker/Temporal tests in supported isolated
   environments; do not treat their default skips as success.
6. Finish user documentation, README/screenshots, examples and release notes;
   audit generated schemas/contracts after remaining model changes.
7. Review the full diff, open the PR, resolve remote CI and complete the delivery
   checklist. Publish 2.0.0 only after merge. No v2 PR or release is complete yet.
