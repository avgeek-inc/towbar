# Changelog

All notable changes to Towbar are documented in this file. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/avgeek-inc/towbar/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/avgeek-inc/towbar/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/avgeek-inc/towbar/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/avgeek-inc/towbar/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/avgeek-inc/towbar/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/avgeek-inc/towbar/tree/v1.0.0
