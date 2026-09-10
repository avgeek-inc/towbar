# Changelog

All notable changes to Towbar are documented in this file. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.7.0] - 2026-09-10

### Added

- Secondary sidebars organize entity pages, settings, integrations, and monitoring.
  Inventory and deployment filters, sorting, and selected monitoring entities are
  restored from permalinks and browser history. Profile and Sessions have separate
  settings routes, and Incidents supports entity filters.
- PostgreSQL and Redis backups support Google Cloud Storage and Azure Blob Storage
  alongside S3. Policies can target multiple providers and select a restore source;
  Backup and Restore have dedicated settings pages.
- Workspace, app, and deployment vulnerability views expose severity totals,
  package findings, available fixes, and links to the scanned deployment. Sidebar
  counts surface critical and high findings.

### Changed

- Secrets File mode loads the selected scope and stage with one bulk-reveal request.
- Tables use regular-weight values and smaller, consistently spaced secondary text.
  Code and standalone numeric values use Geist Mono; chips containing words retain
  the interface font.
- Shared timestamps show relative time above the local date and time, formatted as
  `15:26, 10 Sept 2026`, with the timezone available on hover or keyboard focus.
- The homepage introduces monitoring, alerting, and vulnerability scanning below
  Scout Agent. Documentation includes a scanning guide, refreshed light and dark
  screenshots, and current navigation, secrets, and backup/restore instructions.
- Updated JavaScript dependencies from the merged dependency group.

### Fixed

- Azure single and chunked backup uploads use valid metadata names. Restores use
  the retained backup's original provider and S3 region after manifest changes.
- Retention retries partially deleted backups instead of forgetting remaining
  copies. GCS backups preserve verified customer-managed encryption metadata.
- Vulnerability queries and links respect workspace scoping and archived server
  state, and app findings are paginated.

### Upgrade notes

- Migration `0050` adds workspace Google Cloud and Azure credential tables. Back up
  the Towbar database and preserve `TOWBAR_CREDENTIALS_KEY` before upgrading.
- Existing S3 policies remain supported. Connect the required workspace cloud
  integrations before enabling new backup destinations. Keep credentials for the
  original provider while retaining backups created before a policy change.
- No Scout Agent reinstall or workload redeployment is required for this release.

## [1.6.5] - 2026-09-09

### Added

- The overview pairs a seven-day deployment trend with illustrated app, resource,
  server, and active-incident counts, followed by a full-width recent deployments
  table. Counts link to their list pages, and incident artwork reflects health.
- Secrets support Form and File tabs. File mode reveals stored values for `.env`
  editing, highlights variable references, and saves only changed values.
- Deployment manifests use a read-only YAML editor with syntax highlighting,
  line numbers, scrolling, and a copy action inside the standard widget layout.
- Action buttons across the app include consistent icons, including confirmation,
  retry, authentication, and pending states.

### Fixed

- Secret key inputs fill their available width and configured-value masks are
  vertically centered. Environment and stage selectors use tabs on larger screens
  and icon-labelled dropdowns on mobile.
- The sidebar header stays fixed while navigation scrolls. Sign out has a divider
  and red styling.
- Source titles open their GitHub repository in a new tab.

### Upgrade notes

- No database migration, Scout Agent reinstall, or workload redeployment is
  required. Update Towbar to receive these interface improvements.

## [1.6.4] - 2026-09-09

### Added

- Owners can reveal and hide individual environment secrets with the eye control.
  Hidden values show stars; visible variable references are highlighted in yellow.
  Revealing a value does not save or modify it.
- Environment values support explicit `{{globals.ENV_KEY}}` and
  `{{source.ENV_KEY}}` references within the same environment and stage.
  Source values can reference globals, and references can be embedded in text.
- Status, deployment-trigger, environment, health, and Scout chips include icons
  that identify healthy states, running containers, queued work, and problems.

### Fixed

- Running containers and in-sync configurations use green chips. Recovered
  incidents, warning alerts, critical failures, and Scout states use consistent
  status colors across entity pages, monitoring lists, and incident drawers.
- YAML and captured-log panels scroll vertically and horizontally within the
  code area while keeping the header and copy button visible.
- Container restart events use status chips alongside deployment events.

### Upgrade notes

- Shared secrets are no longer inherited automatically. Before the next app or
  resource deployment, add explicit references for each shared value it needs.
  Existing containers retain their current environment; shared values remain
  stored. Missing or invalid references stop deployment with a value-free error.
- Secret reveal is owner-only, audited without values, and excluded from caching.
  References reveal their stored expression. Server SSH and Cloudflare credentials
  remain write-only.
- No database migration or Scout Agent reinstall is required.

## [1.6.3] - 2026-09-07

### Added

- Resource lists recognize known container image repositories and show the product
  logo and name, including Temporal, Mailpit, Supabase, OpenTelemetry, developer
  runtimes, AI tooling, and self-hosted applications.
- Bundled product artwork includes light/dark presentation and an extensible
  catalog of explicit repository aliases. Tags and digests do not affect matching;
  unknown images and private mirrors retain the Docker fallback.
- Resource documentation explains logo recognition, with artwork attribution and
  registry verification references included alongside the catalog.

### Upgrade notes

- No database migration, Scout Agent reinstall, or workload redeployment is
  required. Update Towbar to display the new resource identities.

## [1.6.2] - 2026-09-07

### Added

- Scout performance history supports Last 15 minutes, Last 30 minutes, and custom
  date/time windows, with Last 15 minutes as the default. Drag across a chart to
  zoom all charts and deployment/restart events to the selected range. Reopen
  Custom range to adjust it, or choose a relative preset to reset the zoom.
- REST and MCP monitoring queries support the same custom windows, with retention
  validation and bounded chart/event results.

### Fixed

- Vulnerability scans now work with non-root SSH users such as `deploy`. Trivy
  reads a dedicated archive mount while the host temporary directory stays
  private and scanner capability, network, and resource restrictions remain intact.
- Failed scans show bounded, sanitized SSH diagnostics instead of only a generic
  command failure, making permission and scanner errors actionable.
- Overview counts link to their Sources, Apps, Resources, and Servers lists.
- Clicking performance charts no longer draws a focus border; keyboard focus
  styling remains available.

### Upgrade notes

- No new database migration or Scout Agent reinstall is required. Deploy matching
  API, web, and worker builds to use the new monitoring query options.
- After upgrading, rescan deployments whose vulnerability scans failed with
  archive permission errors. Workload redeployment is not required. A completed
  scan may report vulnerabilities; it does not imply that the image is clean.

## [1.6.1] - 2026-09-07

### Added

- Scout alerts for servers, apps, and resources, including metric thresholds,
  missing reports, container restarts, and public HTTP checks. Rules trigger on
  the first qualifying reading, recover when conditions clear, and notify once
  per active incident, with optional recovery notifications and maintenance mutes.
- Slack and email notification destinations, with incident details, performance
  history, and delivery history in a side drawer. Alert rules are scoped to each
  entity and capped at ten per entity.
- Workspace Monitoring pages for Performance, Alerts, and Incidents, with searchable
  entity selection, read-only alert links, and active-incident and resource-pressure
  sidebar counts. Resource-pressure counts use fresh readings above 80% without
  requiring configured alerts.
- Deployment performance comparisons with baseline selection, observation windows,
  and data-coverage checks, plus REST, MCP, and Mintlify documentation updates.
- Compact 30-minute Scout CPU and memory graphs in the server list, performance
  widget icons, and dotted 80% thresholds. Inactive agents show no graphs.
- Cloud-provider metadata support for Hetzner Cloud, Oracle Cloud, DigitalOcean,
  Akamai/Linode, and Alibaba Cloud ECS, alongside AWS, Azure, and GCP. Providers
  without an observed plan name display CPU and memory capacity instead.
- Optional `container.networkAlias` for stable private app hostnames on the Docker
  network, with conflict validation, runtime drift detection, and rollback support.

### Fixed

- Prevent HTTP checks that are not due from blocking other scheduled checks.
- Prevent duplicate alert notifications when a destination is removed or muted,
  and preserve notification eligibility after concurrent maintenance suppression.
- Open app and resource notification links at their source-scoped monitoring pages.
- Preserve icon spacing in shared button links and refine Scout filters, severity
  indicators, incident timestamps, and notification table actions.
- Validate the exact browser-only API route inventory as new monitoring routes are
  added, resolving the CI verification failure without changing the public API boundary.

### Upgrade notes

- Includes database migrations 0044–0049 for Scout alerts and incident context.
  Deploy matching API and worker builds. The Scout binary and reporting contract
  are unchanged; alert rules remain opt-in.
- HTTP checks run from the control plane and do not replace independent external
  uptime monitoring. Run **Check server** after upgrading to refresh provider metadata.
- Apps using `container.networkAlias` use stop/start replacement, with a brief
  interruption during startup and health checks. Preview deployments and
  self-managed worker deployments do not support this mode.

## [1.6.0] - 2026-09-06

### Added

- Scout Agent: opt-in server, app, and resource monitoring with observations every
  30 seconds. Install, update, and uninstall it from Server → Settings → Scout Agent.
  Linux AMD64 and ARM64 binaries are bundled with the Towbar worker and run as
  separate collector and sender systemd services with bounded resource use.
- Dedicated Scout Agent tabs with CPU, memory, disk, network, and workload
  performance history; relative time ranges, average/peak views, instance and
  preview filters, and deployment/restart markers with time-zone-aware tooltips.
- Deployment and restart events scoped to the selected duration, shown 10 per page
  and capped at the latest 200 events. Missing measurements use dotted connectors.
- Per-server history retention of 7, 15, 30, or 60 days, defaulting to 15 days,
  with backend aggregation and expiry. Online status requires a received report.
- API and MCP support for Scout Agent configuration and performance history,
  plus a dedicated Mintlify guide and the Scout Agent mascot in setup and empty states.

### Changed

- Chart filters retain previous data while updates load, with deferred rendering
  for off-screen charts and stable layouts during duration changes.
- Server Host Keys now lives under Settings. Removing an unused server uninstalls
  Scout Agent before forgetting SSH credentials, with retries for interrupted operations.
- Simplified the README with a feature table, Scout Agent introduction, and links
  to Mintlify as the source for installation and configuration instructions.

### Upgrade notes

- Includes database migrations 0042 and 0043 for monitoring storage and durable
  agent operations. Deploy the matching API and worker builds before installing
  Scout Agent on servers. Existing servers remain opted out until installation
  is acknowledged. Uninstalling retains collected history until its expiry.

## [1.5.4] - 2026-09-06

### Fixed

- Deleting a Source preserves workload ownership for subsequent server checks,
  allowing leftover Towbar Docker objects to appear in Cleanup for on-demand
  removal. Existing services keep running until explicitly cleaned up.
- GitHub preview deployments use one environment per App, named
  `App name · Preview`, instead of creating an environment for every PR. Each
  preview retains its own URL and status without deactivating other previews.

### Added

- Remove server in Settings, with matching API and MCP support. Removal is hidden
  and rejected while source-backed Apps, Resources, or undeleted previews remain,
  and running operations also block removal. Removing an unused server forgets
  its credentials and trust without terminating the machine or its services.
- Observed instance type and compact cloud-provider logos in server connection
  details and shared server metadata.
- Published GitHub releases sync their versions, notes, links, and associated
  issues to the Towbar Releases pipeline in Linear.

## [1.5.3] - 2026-09-05

### Fixed

- Server preparation loads the existing Cloudflare environment file when validating
  Caddy, allowing servers already using DNS TLS to complete preparation.
- Preparation failures preserve the useful diagnostic, redact Cloudflare token
  values, and no longer append unrelated conflicting-installation advice.
- Server checks support workloads from multiple Sources on workspace-owned servers,
  fixing the missing-source `replaceAll` crash while preserving ownership checks.
- The website uses darker gold in light mode for readable text and buttons, and
  requests screenshots at sizes appropriate to their displayed layout.

### Added

- Production website analytics through DataFast, including a goal for GitHub
  repository clicks and updated privacy disclosures.

## [1.5.2] - 2026-09-05

### Added

- Bearer-key REST API and Streamable HTTP MCP for infrastructure operations with current workspace permissions, read-only/full access, expiry, and revocation.
- Task-oriented MCP tools with namespaced intent names, direct arguments, combined diagnostics, bounded inventories, and a dedicated tool reference.
- Persistent shared API/MCP rate limiting, defaulting to 60 requests per minute per IP and configurable through environment variables.
- API & MCP settings with one-time key reveal, key inventory, and client setup for Codex, Cursor, VS Code, and Claude Code.
- Mintlify API guides, OpenAPI request and response schemas, and per-route references grouped by resource and task, generated from the shared control-plane handlers. Key management, notifications, personal account changes, browser sessions, and GitHub installation handoffs remain in the browser control plane.

### Fixed

- Updated `fast-uri` to 3.1.6 to resolve four high-severity URL normalization and host confusion advisories.
- Homepage screenshots now show the latest control plane in both themes without extra canvas space.

### Changed

- Updated compatible runtime dependencies and CI setup actions while retaining the existing TypeScript and ESLint major versions.
- Dependabot groups minor and patch JavaScript updates separately from major upgrades.

## [1.5.1] - 2026-09-05

### Fixed

- Upgrades with existing orphan-cleanup history now make the Source reference
  nullable before clearing it during the workspace-owned server migration.
- Social previews now use the custom Towbar artwork for Open Graph and Twitter,
  with a shorter homepage description, clearer title, and explicit canonical URL.
- GitHub health explains when an access check is over 24 hours old and prioritizes
  disconnected or suspended installations over a previous successful check.
- Ready servers no longer show the completed server preparation panel.
- Server SSH private-key fields fill the available width and start at three rows.

### Changed

- Cloudflare credentials use a masked, single-line Account API token field.
  Saving credentials requires a newly created or rolled `cfat_` account token;
  personal tokens and older unprefixed tokens are rejected. Setup instructions
  include the zone permissions needed for DNS and SSL mode checks.
- Source production branch names include a branch icon.

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

[Unreleased]: https://github.com/avgeek-inc/towbar/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/avgeek-inc/towbar/compare/v1.6.5...v1.7.0
[1.6.5]: https://github.com/avgeek-inc/towbar/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/avgeek-inc/towbar/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/avgeek-inc/towbar/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/avgeek-inc/towbar/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/avgeek-inc/towbar/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/avgeek-inc/towbar/compare/v1.5.4...v1.6.0
[1.5.4]: https://github.com/avgeek-inc/towbar/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/avgeek-inc/towbar/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/avgeek-inc/towbar/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/avgeek-inc/towbar/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/avgeek-inc/towbar/compare/v1.4.0...v1.5.0
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
