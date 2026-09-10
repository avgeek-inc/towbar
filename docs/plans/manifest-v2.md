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

## Follow-up implementation checkpoint

The working tree now also contains repository discovery/connection endpoints and UI, an environment table with branch editing and per-environment/sync-all actions, server slug create/edit controls, mapped-branch push routing, and named secret lookup during deployment execution. These paths still need the broader integration and rendered-route review listed above. They are not evidence that the full checklist is complete.

Deployment admission now locks the environment before the instance, matching reconciliation lock order. It rejects changed mapping revisions or commits, disconnected environments, and instances archived since the initial admission check. The PostgreSQL suite now reports eight passing tests, including a concurrent branch edit blocked by the admission lock and rejection of stale mapping revisions. API and web typechecks pass.

Branch edits queue configuration sync with `deployAfterSync: false`; the UI describes that behavior. Explicit Sync all retains automatic deployment eligibility and reports partial queue failures instead of a blanket success. Required remaining work includes preview integration, deployment environment modeling and deferred operations, secret editing UX, logical entity navigation, removal of temporary v1 paths, API/MCP/schema generation, fixtures/docs, end-to-end verification and PR/CI.

Automatic/deferred scheduling now requires an environment identity, selects its own synced commit, and rejects mappings changed since that sync. The maintenance resume scan scopes work to environments with deferred instances and skips disconnected or paused environments. Release lookup excludes PR preview releases. The database suite additionally proves production and staging select distinct commits, a staging-only resume leaves production untouched, and an unsynced branch edit skips staging while production remains eligible. Old source-level automatic/preview scheduling calls were removed from this path; v2 preview reconciliation must be wired back through the environment-aware preview implementation before completion.

Preview routing follow-up: reconciliation now discovers PRs against connected, synced, preview-enabled environment branches and still revisits existing reports when no environment enables previews. Successful explicit environment syncs invoke this scheduler again. Event handling filters app instances by the target environment branch and current mapping revision; manual redeploy validates the instance's environment instead of Source.branch. Preview hostname/runtime identity now uses the instance UUID. Sixteen targeted PR-policy/database tests pass, including mapped staging discovery and cleanup discovery after disabling previews. Exact PR-commit entity configuration loading, preview admission concurrency guards, required-secret validation against PR declarations, and retarget cleanup remain incomplete; this is not end-to-end preview proof.

PR configuration follow-up: automatic and manual preview requests fetch the immutable head SHA with the v2 repository loader and resolve the selected environment's entity files. Build configuration comes from that snapshot; server and preview domain/TTL remain pinned to the connected target. Both target and PR must enable the app preview. PR declarations are checked against isolated preview secret values without reconciling saved slots. Twenty loader/configuration/database tests pass, including immutable loading, PR build changes, target preservation, disabled/removed apps and secret isolation. API typecheck and scoped lint pass. Preview admission still needs transaction-level mapping/instance guards, execution-time enforcement of PR declarations, and retarget/removed-app cleanup; no end-to-end preview deployment has been proven yet.

Preview lifecycle follow-up: cleanup selection now compares existing previews with target environment IDs and evaluated PR app IDs. Retargeted, removed, disabled and input-mismatched apps are selected; previews whose matching target cannot be evaluated because of an unsynced mapping or unready server are preserved. Failed snapshot loading still prevents cleanup. V2 preview admission locks the target environment and instance and rejects changed mapping/configuration, archived/disabled apps and changed server assignment. Sixteen cleanup-selection/database tests pass, including stale admission rejection. The test suite's preview admission checks were extracted into `environment-preview-tests.ts` to stay within the repository file-size gate. Execution-time declaration enforcement, cleanup/admission races across PR head changes and full workflow proof remain outstanding. Legacy unlinked fixture instances still bypass the environment guard and must be removed during the v1 fixture/schema conversion.

Execution follow-up: migration 0052 adds a required-secret declaration snapshot to deployments. Normal deployment, rollback and preview admissions populate it; worker resolution validates required keys for executed stages against current isolated secret values. PR declarations therefore survive queuing independently of the target manifest's declarations. The real database suite passes thirteen tests, including worker rejection of unset/PR-only keys and acceptance of an intentionally empty preview value. Migration application, database build, API typecheck and scoped lint passed. The new column is temporarily nullable for unconverted fixtures/callers and must be tightened with the final v2 schema. Full workflow execution and API/MCP contract generation remain outstanding.

PR ordering follow-up: automatic reconciliation and manual preview redeploy share a per-source/PR PostgreSQL advisory lock. Overlapping activity retries/manual requests are rejected with a retryable conflict instead of applying competing plans. Automatic reconciliation re-fetches the PR before recording the plan or requesting cleanup; a changed revision returns `retry: true`. Manual redeploy similarly rechecks before admission. Twenty PR-policy/database tests pass, including lock exclusion, distinct PR independence, release after success/failure, and detection of head/target/state changes during loading. API typecheck, scoped lint and diff checks pass. GitHub state cannot be transactionally locked; updates after the final read still rely on subsequent reconciliation. Worker workflow/cleanup/reporting delivery integration remains to be exercised end to end.

Environment controls follow-up: the table now exposes Add environment, revision-checked Disconnect with confirmation, and Reconnect. The connect form validates the supplied environment name and mapped branch through the existing server endpoint and presents errors inline. Disconnect copy states that running workloads and data remain; disconnected rows show previews disabled. The web client now supports a JSON DELETE body for mapping revision checks. Reconnection clears the pause flag introduced by disconnect, while initial sync remains non-deploying. Rendered fixture QA, branch discovery selection and richer pre-connection review are still pending.

Source navigation follow-up: the catch-all route allowlist now accepts `environments`, fixing the default-view redirect to a 404. Environments has an entity icon in page/sidebar navigation. The Source manifest view now selects an environment and individual YAML file, using an owner-scoped read endpoint for the last successful environment snapshot. Environment/file selections are permalink query values. The shared responsive selector was extracted from Secrets to preserve mobile dropdowns and desktop tabs. The legacy Source-wide manifest request no longer gates the Source page. Database checks verify distinct production/staging snapshot commits, YAML file retrieval and cross-workspace rejection. Rendered route verification remains pending fixture conversion.

Secrets UI follow-up: GET secret bindings returns available named environments and defaults app/resource requests to their instance environment. Workspace/source choices are derived from connected repository environment names. Resource reveal no longer requires the literal production scope. The UI consumes these choices, hides key add/remove controls for declared bindings, rejects file-mode key changes, and treats unset fields as unconfigured. File mode includes required unset keys as blank assignments and explains that an explicit save sets blank values to intentionally empty strings. The database suite verifies staging choices and preview scope isolation; thirteen database tests, API/web typechecks and scoped lint pass. Full fixture conversion and rendered Form/File verification remain pending; temporary legacy default choices still need removal with the v1 paths.

Shared-secret scope verification: affected deployables are filtered to the selected environment and preview scopes exclude resources/disabled apps. Preview detection uses the exact preview scope or `preview:` prefix, avoiding misclassification of ordinary environment names. The full API test command reports 136 passes and 11 skips; the separate PostgreSQL environment suite reports thirteen passes, including distinct production/staging affected-instance lists. API/web typechecks and scoped lint pass. These checks do not replace skipped integration suites or full workflow/browser verification.

Instance navigation follow-up: app/resource list and detail queries now expose logical entity IDs and environment identity, branch and disconnected status. The web client requires these fields (temporarily nullable for unconverted v1 fixtures). App/resource detail pages offer an environment selector that resolves sibling instances by source and logical entity, keeps the section path and clears instance-specific query parameters. The PostgreSQL suite reports fourteen passes, including list/detail identity consistency, workspace isolation and app/resource kind separation. API/web typechecks and scoped lint pass. The selector has not yet been verified in a rendered v2 fixture; logical list grouping, full v2 fixtures and non-null schema conversion remain outstanding.

Inventory environment follow-up: workload list filters now accept an environment name and return source-scoped environment options independently of the current health/server/search filters. Workspace app/resource sidebars persist that choice in the URL. Workspace and source tables show environment, mapped branch and disconnection state alongside each instance's own health and capacity. Five inventory tests pass, including intersected filters, missing-environment exclusion and stable options. Core build, API/web typechecks and scoped lint pass. Logical entity grouping and rendered v2-fixture verification are still outstanding; the current rows remain instance rows so per-environment capacity and health are not conflated.
