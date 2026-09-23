# Changelog

All notable changes to Towbar are documented in this file. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- GitHub repository connections store the selected installation's internal
  record ID, allowing newly connected repositories to be imported successfully.

## [2.0.7] - 2026-09-23

### Changed

- SSH host verification now selects the ED25519 host key when available and
  presents one recommended fingerprint for approval.
- Successful SSH verification for a pending server now continues directly to
  server preparation.
- Server preparation timelines use their status icons without duplicate status
  chips, with tighter alignment and a simpler preparation action.
- Mobile navigation, page headings, form controls, account identity and
  integration layouts use the available screen width more effectively.
- Dashboard queue and deployment-trend summaries stay concise on narrow screens,
  and integration cards avoid repeating page-level icons, help and empty-state
  status.

### Fixed

- Fresh Ubuntu servers no longer stop before Docker installation when optional
  conflicting packages are absent.
- SSH checks and server-preparation steps return actionable, step-specific
  guidance when the remote command exits without diagnostic output.
- Narrow integration pages keep widgets at full width until the remaining
  content area can comfortably fit two columns.

## [2.0.0] - 2026-09-20

### Added

- Persistent app files through manifest-defined volumes, with separate storage
  per environment and preview, explicit initialization and retained data on removal.
- Manifest-defined application jobs with UTC schedules, manual runs, execution
  history, timeouts and bounded output. Jobs use the deployed image and its mounts.
- An administrator browser SSH terminal with pinned host keys, session checks
  and audited connections.
- Team onboarding, Admin/Member/Viewer access control, direct member creation,
  email-scoped invitations, member role management and team audit logs.
- Personal and team API keys with role-aware permission limits, plus personal
  profile, verified email change, password, session, authenticator and passkey
  management.
- Persistent server preparation checklists with inspection details, prerequisite
  installation output and terminal logs.
- Runtime-configured log forwarding for New Relic, Axiom, Better Stack, Datadog,
  OpenTelemetry and Loki. App and resource manifests select destinations; a
  bounded gateway sends container output independently from deployment work.
- Host-only administrator recovery and two-factor reset commands, plus uninstall
  and recovery documentation.
- Named environments for apps and resources, including production and staging.
  Each instance has its own configuration, server assignment, deployment history,
  secret values, volumes, backups, and monitoring identity.
- Repository onboarding discovers declared environments and lets owners select which
  to connect. Branch mappings, branch changes, disconnects, and reconnects are
  managed in Towbar. Initial connection and mapping changes sync without deploying.
- Required secret declarations create unset editor slots during successful sync.
  Existing values and shared references are preserved for unchanged keys; removed
  declarations remove their saved values. Missing values block deployment while
  allowing configuration sync.
- Environment controls and filters across Repository inventories, entity pages,
  deployments, and monitoring, with environment selection retained in permalinks.
- Separate editor schemas and runnable examples for the v2 repository, app, and
  resource configuration files.

### Changed

- **Breaking:** replace the v1 deployment manifest with root `towbar.yml`
  (`version: 2`) and one entity per `*.app.yml` or `*.resource.yml` under
  `.towbar/apps/` and `.towbar/resources/`. Entity files declare shared settings
  and explicit environment overrides. Objects merge; arrays replace.
- **Breaking:** branch names belong to Repository environment mappings in Towbar.
  They are no longer configured in YAML or stored as one branch per Repository.
- **Breaking:** workloads reference the IP address of a server registered in
  Towbar. Credentials and preparation settings remain in Towbar.
- **Breaking:** secret keys for app/resource instances are declared in YAML;
  Form and File modes edit their values. Preview secrets are isolated by target
  environment and do not fall back to persistent environment values.
- Preview eligibility follows the PR base branch's mapped environment and requires
  both environment-level enablement and app opt-in. PR configuration does not
  reconcile persistent instance settings or required-secret slots.
- Environment sync resolves one immutable commit, validates the complete effective
  configuration, and reconciles atomically. Invalid or unavailable configuration
  preserves prior state; mapping revisions prevent stale jobs from overwriting it.
- The dashboard now calls source-control connections Repositories. Existing REST
  `/sources` paths and stable MCP tool identifiers retain their API names.
- Integration credentials are supplied by the Towbar runtime environment. The
  dashboard exposes only providers with complete runtime configuration; GitHub
  App installation and GitLab OAuth authorization remain interactive.

### Fixed

- Redis restores load RDB snapshots before enabling append-only persistence,
  preventing an empty database from passing restore health checks.
- Completed environment syncs remain successful when delayed retries or lost
  queue responses arrive after the worker has progressed.
- Declared secret inputs use the full card width on mobile.
- Deployment and rollback admission reject disconnected, stale, archived, or
  unprepared targets, and retain the selected environment in deployment snapshots.
- Runtime identities use instance IDs, preventing sibling environments from
  sharing deployment cleanup or resource-operation identity.
- Resource deployment execution no longer requests GitHub build credentials when
  it only needs to pull an image.
- Preview cleanup reports Docker failures and also removes runtime-labeled
  candidates that have no committed release record.
- Non-root Trivy execution mounts the readable image archive without exposing its
  private parent directory to the scanner container.
- Branch mapping errors remain visible beside the edit form while preserving
  the entered branch and previous mapping.

[Unreleased]: https://github.com/avgeek-inc/towbar/compare/v2.0.7...HEAD
[2.0.7]: https://github.com/avgeek-inc/towbar/releases/tag/v2.0.7
[2.0.0]: https://github.com/avgeek-inc/towbar/releases/tag/v2.0.0
