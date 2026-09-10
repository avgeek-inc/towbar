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
  exist. Workspace and Source inventories group instances by logical entity,
  retaining each environment row and direct instance link. Deployment chips show the recorded environment name. Monitoring
  entity search and alert/incident identities include environment names; kind
  filters distinguish persistent deployments from previews.
- Fixtures: production/staging sibling app and resource instances and history
  filters exist. Browser checks proved a staging history permalink, opening its
  app instance, switching to production, and Back restoring staging. Per-environment v2 manifest snapshot fixtures are validated through the parser;
  the obsolete source manifest endpoint returns 404. Discovery returns v2
  environment declarations and rejects unavailable branches/installations.
  Unsupported writes fail rather than returning cached read data. The obsolete
  v1 creation fixture/test are removed. Stateful connection/initial sync and
  secret fixture handlers still need conversion.
- API/MCP: current catalogue has 140 operations and 55 curated tools. Generated
  contracts and owner/read-only boundaries are checked. The MCP integration
  fixture now explicitly connects an environment before editing shared secrets.

## Latest verification

- Fixture discovery and unsupported-mutation regressions pass; all 24 fixture
  tests pass. Stateful v2 connection and initial sync are not yet fixture-tested.

- Rollback admission now locks the environment, instance/server and selected
  retained release before insertion. It rejects changed configuration, archival,
  unavailable releases and releases from another server, and only selects
  persistent releases. The database regression observes a real row-lock wait,
  archives the instance, then verifies no rollback is admitted; it also rejects
  a preview release. All 14 environment tests and the full 228-test API database
  suite pass without skips. API typecheck and scoped lint pass.

- Final identity pass: persistent API execution contexts and deployer defaults
  use the instance UUID, not the shared manifest ID. Resource image cleanup
  labels use that same identity. The database execution-context regression and
  all 16 secrets/inventory tests pass; deployer defaults pass 122 tests with two
  explicit Docker skips. `pnpm verify` passed after these changes, including
  docs, formatting, lint, types, standard tests and builds. Real Docker and
  Temporal results below remain separate from this default gate.

- Resource ownership audit: backup, runtime actions and restore preflight now
  require the exact instance label. Removed the legacy manifest-label fallback
  and its positional arguments. A shell regression rejects sibling and missing
  instance owners before Docker operations, and accepts the exact owner for log
  capture. All 34 focused resource tests, deployer typecheck and scoped lint pass.
  Volume paths use instance IDs; complete database data/backup isolation still
  needs complete execution proof. Restored-container cleanup labels now use
  the instance ID, matching normal resource deployments. The opt-in Redis Docker
  promotion test proves new-volume activation, previous-volume retention, correct
  ownership labels and unchanged sibling environment data. Test containers and
  volumes were cleaned up; archive download/import is outside this test.

- Opt-in Docker execution: the alias integration test passed with real
  containers, checking replacement, collision rejection, rollback and independent
  responses from the same alias in separate production/staging networks. Cleanup
  left no test containers. These are explicitly separate configured networks;
  this does not prove complete API-to-worker environment deployment.
- Opt-in Temporal execution: the Scout loop passed worker restart, queued wake
  signal and persisted-history replay against a disposable local Temporal server.
  Its evaluation activity is a test stub, so database evaluation and deployment
  execution require their own proof. The disposable server was stopped afterward.
- Trivy's private-archive permission regression requires native non-root Linux;
  it has not been executed on this macOS host.

- Inventory grouping: focused identity/scope regression, web typecheck and
  scoped lint pass. Rendered Apps and Resources show production/staging siblings
  in one logical group; staging filtering, opening its instance and browser Back
  restoring the filtered list were verified. Sidebar, overview, Source and API
  inventory counts now deduplicate logical entities. Overview running chips
  explicitly count instances; server workloads retain instance counts. Core
  filter/count and Source count regressions pass, as do all 24 fixture tests
  and the 16-test secrets/inventory database suite.

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
2. Complete the audit of resource operations, backups/restores, monitoring,
   alerts and scanning
   for instance/environment scope and labels. Validate that resource secret
   stage declarations match stages the resource editor and execution support.
3. Verify remaining environment controls, readiness, validation failures and
   permalinks in rendered pages, including Source-scoped inventory views.
4. Complete declared-secret fixture handlers and per-environment manifest
   configuration fidelity. Connection/discovery, branch edits, disconnect and
   reconnect now have stateful fixture coverage.
   Exercise Form/File editing, reveal, missing/empty values and branch changes.
5. Prove complete local production/staging app/database and PR workflows,
   including failure isolation, stale jobs, cleanup, resource data separation and
   worker execution. Run relevant Docker/Temporal tests in supported isolated
   environments; do not treat their default skips as success.
6. Finish user documentation, README/screenshots, examples and release notes;
   audit generated schemas/contracts after remaining model changes.
7. Review the full diff, open the PR, resolve remote CI and complete the delivery
   checklist. Publish 2.0.0 only after merge. No v2 PR or release is complete yet.

### Onboarding browser verification

The local fixture-backed browser verified repository discovery, connecting only
staging from `develop`, changing its branch to `main`, disconnect confirmation,
disconnected state and preview disabling, reconnect confirmation, and sync detail
navigation. The sync detail breadcrumb now leads to `/sync-history` instead of
the obsolete `?section=info` route. Fixture sync records are readable by ID and
scoped to their source; all 25 fixture tests, web typecheck and targeted lint pass.
This is UI/fixture evidence, not proof of real GitHub fetch or worker execution.

### Declared-secret editor browser verification

For a newly connected staging app, the browser opened File mode with an unset
`NPM_TOKEN`, saved an intentionally empty string, reopened bulk reveal, and
rejected replacing the declared key with an undeclared key while retaining the
draft. A corrected file edit survived switching to Form and saved successfully.
Fixture API readback verified the saved staging value and that the production
instance's key remained unset. App/resource breadcrumbs now use the corresponding
source inventory page paths. This verifies editor behavior against fixture
bindings; real secret reconciliation and deployment admission still require their
API/database and workflow checks.

### Worker self-deployment identity audit

The full API suite passed against the isolated PostgreSQL database: 228 tests,
zero skips. Auditing execution found the worker still compared `TOWBAR_APP_ID`
(the runtime instance identity) with the logical manifest app ID when deciding
whether to defer cleanup of its own container. It now uses the deployer's runtime
identity function. A regression covers persistent self-deployment, staging
siblings, preview identity, and a worker without a runtime ID. Worker typecheck
and lint pass; its suite reports 29 passed and two opt-in integration tests skipped.
A real self-deployment remains part of workflow verification, not proven by this
identity-selection test.

### Real resource deployer lifecycle

`tools/e2e/resource-lifecycle.mjs` passed against a disposable Ubuntu target with
non-root SSH and a separate nested Docker daemon. It ran the production deployer
through two same-logical-ID Redis instances, independent data writes, a staging
redeployment, and a staging candidate that failed its health check. Assertions
verified both data sets survived, production's container stayed unchanged, the
old staging container was removed after successful promotion, and failure
restored the retained staging runtime without leaving a failed candidate.
The target and temporary credentials were removed after the run. Configuration,
secrets and release commit callbacks are supplied by this runner; API/database
admission and Temporal execution are still separate outstanding checks.

The database-backed mode also passed against the isolated test PostgreSQL
instance. It seeds environment mappings and encrypted secrets, resolves execution
context through production API services, and commits actual release transactions.
Assertions verified two current releases matching the running containers, one
previous release, three successful deployments with secret revision snapshots,
and no release for the unhealthy candidate. The runner removes its workspace
rows and target afterward. HTTP admission and Temporal delivery are not exercised;
the failed attempt stays at checking_health until cleanup because workflow
failure handling is outside this direct-service harness.

### Temporal resource execution

The resource lifecycle passed with the production deployment workflow and
activities on a disposable local Temporal server. Activities called the real
signed internal HTTP API, which resolved encrypted secrets and committed release
transactions in the isolated PostgreSQL database. Three workflows completed;
the unhealthy candidate produced a failed workflow and terminal failed database
state while preserving the previous runtime. All four histories replayed
successfully. The worker, API listener, workspace rows and Docker target were
cleaned up. Requests remain seeded directly: user-facing admission and server
queue coordination are not proven by this execution test.

### Resource admission and server coordinator

The Temporal resource lifecycle now uses `requestAppDeployment` instead of
inserting deployment rows. With seeded successful sync snapshots and server
readiness, it passed production/staging admission, idempotent request replay,
real server-coordinator delivery, signed worker API calls, release commits,
failed-candidate recovery and workflow replay. Each run uses its own Temporal
namespace. API typecheck and scoped lint pass. API shutdown now closes its cached
Temporal client as well as PostgreSQL; test cleanup also closes that connection.
This does not prove public request authentication or GitHub synchronization,
because the runner calls admission directly and seeds the source snapshots.

### Full gate after admission integration

`pnpm verify` passed at `08aaadb`, including docs, formatting, lint, typecheck,
tests and builds. Default test execution still skips opt-in integration suites:
API reported 137 passed/11 skipped, deployer 122 passed/2 skipped, worker
29 passed/2 skipped. These skips do not replace the separately recorded real
PostgreSQL, Docker and Temporal runs. The subsequent README update documents v2
file paths, environment mappings, required-secret setup and repository examples;
docs checks and formatting pass after that change. Screenshots still need a v2
refresh.

### Linux non-root vulnerability scanning

`node tools/e2e/trivy-lifecycle.mjs` passed on the disposable Ubuntu target over
SSH as `deploy`. The production Trivy script scanned Alpine successfully with
its sandbox restrictions. The previous private-directory mount failed with
permission denied under the same Linux identity and restrictions, confirming
the archive-only mount fixes the non-root regression. Successful scans and both
permission/missing-image failures removed temporary archives. The Docker target
and nested scanner cache were removed afterward. This supplies actual Linux
scanner evidence rather than counting the default opt-in skip as a pass; scan
scheduling and findings presentation are outside this runner.

### Application Docker build and runtime isolation

`node tools/e2e/app-lifecycle.mjs` passed using the production deployer over SSH
against the isolated Linux target. It built a Python HTTP application using a
BuildKit secret mount and started production, staging and preview runtime IDs
for the same logical app. HTTP assertions verified independent runtime values,
staging replacement at a new immutable source revision, and preservation of
production and the previous preview after an unhealthy preview candidate.
Only the three retained containers remained; the target was removed afterward.
GitHub archive responses and release commits are simulated in this runner.
It does not establish public TLS, real GitHub authentication, API admission for
apps, or PR lifecycle reconciliation and cleanup.
