# Changelog

All notable changes to Towbar are documented in this file. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Upgrades with existing orphan-cleanup history now make the Source reference
  nullable before clearing it during the workspace-owned server migration.
- Social previews now use the custom Towbar artwork for Open Graph and Twitter.

## [1.5.0] - 2026-09-05

### Added

- Workspace-wide server management, with one server per IP shared across Sources,
  Apps, and Resources, plus detected instance type and capacity information.
- Shared workspace secrets with Source defaults and App/Resource overrides,
  separated by production/preview environment and execution stage.
- Dedicated Apps, Resources, Deployments, and Integrations pages, source inventory
  counts, live allocation meters, and separate server Apps and Resources tables.
- Integration health checks for GitHub and connected AWS credentials.
- A ready-to-fork [example app](https://github.com/avgeek-inc/towbar-example)
  with a Dockerfile, health endpoint, and deployment manifest.
- A new public homepage and feature guides with light/dark screenshots,
  installation instructions, and a first-deployment walkthrough.

### Changed

- AWS credentials are configured once per workspace under Integrations. Slack
  and SMTP provider credentials are configured through installation environment
  variables; notification destinations remain managed in Towbar.
- Tables show timezone-aware timestamps, relative times, running operation
  durations, and consistent workload identity and status indicators.
- Empty states, tables, tooltips, secrets editors, and navigation use consistent
  layouts and compact spacing throughout the dashboard.

### Removed

- Source-owned server configuration and the top-level `servers` manifest field.
  Manifests retain each App/Resource's `server` IP reference; configure hosts in
  Towbar's Servers page instead.
- Deployment plan UI, APIs, stored plans, and their GitHub checks.

### Upgrade notes

This release changes the manifest contract and resets some stored configuration.
Existing 1.4.0 installations must follow the
[1.5.0 upgrade steps](https://www.towbar.dev/docs/self-hosting/upgrades#upgrading-from-140-to-150)
before resuming deployments:

- Back up the control-plane database and preserve `.env` and
  `TOWBAR_CREDENTIALS_KEY`. Older application images cannot undo these migrations.
- Remove top-level `servers` from manifests while preserving deployable server IPs.
- Re-enter server SSH/Cloudflare credentials and workspace AWS credentials.
  Server migration deduplicates records by workspace and IP and deletes stored
  server credential records; the previous source AWS credential table is dropped.
- Configure Slack/SMTP provider environment variables. Previously stored
  notification provider secrets are deleted.
- Verify server trust/configuration, Source sync, integrations, and an actual app
  deployment. Duplicate server check/preparation/host-key records and deployment
  plan history are removed by the migrations.

## [1.4.0] - 2026-09-05

### Added

- Towbar now stores Source, App, Resource, and Preview secrets encrypted in its
  database. Owners manage write-only values in the editor, with Source-wide
  production defaults, local overrides, isolated Preview values, explicit
  deployment after edits, revision conflicts, and pending-change visibility.
- Server SSH and Cloudflare credentials, plus installation Slack and SMTP
  credentials, now use the same encrypted, write-only settings flow.

### Changed

- Deployments resolve a consistent set of current values when execution starts,
  preserve BuildKit secret mounts and runtime and hook injection, and record only
  the encrypted-setting revisions used. Image rollbacks and server, resource,
  and notification operations use current credentials.
- Sources can be synchronized and inventoried before credentials are configured.
  Plan validation reports missing Towbar-managed configuration with links to the
  relevant editor, while optional S3 backup and restore retain Source AWS
  credentials.

### Removed

- AWS Secrets Manager integration, secret-reference APIs, reveal controls, and
  all secret fields and provider references in deployment manifests have been
  removed. Existing values are not imported; operators must re-enter required
  values in Towbar before resuming deployments.

## [1.3.4] - 2026-09-03

### Added

- Public Towbar documentation is now published through the Mintlify site.

### Fixed

- Scheduled backup reminders no longer duplicate assurance alerts for the same
  missed window. Slack messages use plain language, and Resource backup settings
  now lead with Backup run, S3 copy, and Restore check health states.

## [1.3.3] - 2026-08-31

### Fixed

- Preview pull request reconciliation now heartbeats while long-running Source
  evaluation is in progress, preventing Temporal from retrying successful API
  evaluations after a false heartbeat timeout.

## [1.3.2] - 2026-08-31

### Fixed

- Pull request plan evaluation is now idempotent per Source, pull request, and
  head commit. Retries reuse existing plans and Preview work, no-change pull
  requests finish as skipped, transient GitHub failures are classified
  accurately, and candidate validation remains scoped to relevant changes.

## [1.3.1] - 2026-08-31

### Changed

- Image vulnerability scanning now requires an explicit
  `vulnerabilityScanning: true` opt-in on each App in addition to the
  installation-wide capability flag. The policy can change without forcing an
  App redeployment, Resources remain unscanned, and prior results are retained.

## [1.3.0] - 2026-08-30

### Added

- Successful deployments record the immutable Docker image digest and platform
  used by the active release.
- Optional Trivy vulnerability scans run once per immutable production or
  Preview image, with owner-controlled rescans, severity totals, scanner
  metadata, and bounded actionable findings.
- Slack destinations group each deployment lifecycle into one durable thread,
  updating its summary while retaining individual event replies.

### Changed

- Vulnerability scans run behind deployment work with isolated scanner
  resources, offline image analysis, bounded output, and automatic recovery of
  abandoned scan claims.

### Fixed

- Credentialed fixture API requests now accept only exact loopback origins and
  reject disallowed origins before route execution.
- Operator password-reset restart markers are isolated from Argon2id login
  verification and cannot be used as password hashes.

## [1.2.0] - 2026-08-30

### Added

- Immutable, side-effect-free deployment plans compare a candidate commit with
  active Source state, classify create/update/archive/restore/no-op changes,
  and validate domains, servers, capacity, secret references, and operation
  conflicts without resolving secret values.
- Deployment-relevant pull requests publish one idempotent GitHub Check linked
  to the full Towbar plan; unmatched input patterns omit irrelevant rows.
- Source-scoped Slack and SMTP notifications persist immutable events and use
  durable, independently retryable delivery attempts.
- PostgreSQL and Redis backups now expose restore-readiness assurance, while
  managed PostgreSQL backups support safety-gated, auditable restores with
  bounded rollback.
- Source owners can pause automatic deployments without disabling manual
  operations or changing the deployment manifest.

### Changed

- Preview deployments honor App change patterns, reconcile interrupted
  lifecycle work, and clean up after pull requests close or merge.
- Source, App, and Resource settings use consolidated navigation with compact
  responsive layouts for notifications, secrets, and backup configuration.

### Fixed

- Preview reporting maintains one aggregate pull request comment across build,
  ready, failure, and cleanup transitions.

## [1.1.1] - 2026-08-28

### Added

- Pull request Preview deployments now maintain one aggregate GitHub comment
  with each App's build status, ready Preview URL, and Towbar deployment link.
  Towbar updates the same comment through build and cleanup transitions.

### Changed

- Preview comments require the GitHub App's Pull requests permission to be
  upgraded from read-only to read and write. Existing installations must
  approve the permission change before Towbar can publish comments.

## [1.1.0] - 2026-08-28

### Added

- Opt-in pull request Preview deployments with stable PR-scoped URLs,
  isolated secrets, GitHub Deployment statuses, bounded lower-priority builds,
  Source-sync recovery, and automatic cleanup after merge, closure,
  retargeting, expiry, disablement, or an owner request.
- Existing GitHub App installations must approve the new read-only Pull
  requests permission and Pull request webhook before enabling Previews.
- Actionable control-plane health checks plus host and container CPU, memory,
  disk, uptime, restart, and runtime-capacity signals.
- Confirmed SSH host-key revocation while preserving the server's trust
  history.

### Changed

- Removed manifest-level deployment dependencies. Eligible automatic
  deployments now queue independently, while operators who need ordering can
  disable automatic deployment and admit downstream deployables manually.
  Manifests must remove any existing `dependsOn` declarations before syncing.
- Shared Source secrets now live under Settings, managed backup policy lives
  under Resource Configuration, and App/Resource/Server inventories surface
  compact operational metrics without redundant status columns.
- Automatic maintenance checks wait behind deployment work, and completed
  server-check history is bounded while active checks remain addressable.

### Fixed

- Application containers now retain their loopback host port across Docker
  restarts, preventing Caddy from keeping an obsolete upstream after an OOM or
  runtime restart.
- Restored the managed Towbar lockup and favicon, kept Docker builds valid when
  no local public assets exist, and aligned the application sidebar spacing.

## [1.0.2] - 2026-08-25

### Added

- Stable GitHub releases can deploy the exact published commit to the Towbar
  host through GitHub Actions, AWS OIDC, and SSM.
- Operators can set a bounded global Temporal activity capacity while each
  destination server continues to enforce its own build concurrency.

### Changed

- Release deployment guidance now documents the immutable GitHub OIDC subject
  used by protected repository environments.
- GitHub Actions use the current pinned Checkout release.

## [1.0.1] - 2026-08-25

### Changed

- Manual App and Resource deployments now immediately admit the latest
  synchronized revision instead of blocking on a Source sync. AWS secret values
  continue to resolve at execution time.
- Scheduler and routing-only server configuration changes preserve prepared
  server readiness.
- Deployment inventory and the floating queue now distinguish active and queued
  work, with clearer boundaries and quieter chart gridlines.
- Updated compatible authentication, Node.js type, lint-support, path-matching,
  and utility dependencies.

## [1.0.0] - 2026-08-24

### Added

- Source-driven deployment manifests for Apps, Resources, Servers, domains,
  dependencies, secrets, and deployment policy.
- GitHub App integration with manual sync and push-triggered deployments.
- Durable deployment and server-preparation workflows backed by Temporal.
- Target-host Docker builds, health checks, Caddy configuration, and rollback.
- Source-scoped AWS Secrets Manager integration and environment editors.
- A same-domain owner setup, authentication, and operations dashboard.

[Unreleased]: https://github.com/avgeek-inc/towbar/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/avgeek-inc/towbar/compare/v1.3.4...v1.4.0
[1.3.4]: https://github.com/avgeek-inc/towbar/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/avgeek-inc/towbar/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/avgeek-inc/towbar/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/avgeek-inc/towbar/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/avgeek-inc/towbar/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/avgeek-inc/towbar/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/avgeek-inc/towbar/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/avgeek-inc/towbar/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/avgeek-inc/towbar/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/avgeek-inc/towbar/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/avgeek-inc/towbar/tree/v1.0.0
