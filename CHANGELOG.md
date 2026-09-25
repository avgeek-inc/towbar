# Changelog

All notable changes to Towbar are documented in this file. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.12] - 2026-09-24

### Added

- Self-hosted runtime settings use `/etc/towbar/towbar.yml`, with grouped
  provider credentials and validation before lifecycle commands. Existing
  installations convert their supported settings while preserving rollback
  configuration; fresh installations create YAML directly.
- Email, Slack, Discord, Telegram, and webhook notification destinations can
  be managed and tested in the control plane. Destinations choose Deployments,
  Backup & Restore, and Alerts & Incidents independently, while provider
  credentials remain in runtime configuration.
- Notification provider pages show configuration empty states and destination
  tables, with updated self-hosting and integration guides.

### Changed

- Repository connections, branch mappings, and manual syncs require Admin
  access. Branch changes retain the existing automation pause state, and the
  redundant Environment automation card is removed.
- Apps and Resources open in the unified inventory view by default. Inventory
  and deployment rows omit repeated branch labels; the deployment queue shows
  an environment chip and live elapsed duration with compact, consistent status
  indicators.
- Cloudflare TLS switch copy uses regular-weight text and tighter spacing.

### Fixed

- Interrupted server checks become failed checks, and maintenance recovers
  stale running records so scheduled checks resume after worker restarts.
- Line-chart tooltips follow the pointer without a delayed transform, and
  switching integration providers keeps the sidebar mounted to avoid logo
  flashes.

## [2.0.11] - 2026-09-24

### Added

- Scout metric and public HTTP alerts can require a sustained breach for 1, 2,
  5, 10, 15, or 30 minutes before opening an incident.
- App, Resource, and Server detail breadcrumbs offer a searchable switcher with
  the corresponding application, resource, or cloud-provider logo.
- App and Resource overviews show the effective repository branch beside the
  repository.

### Changed

- Scout alert actions are Pause and Resume, with yellow controls, while Delete
  is red. New rules start active, and create and edit forms no longer show an
  enabled checkbox.
- SSH keys move into the primary Manage sidebar, and key-type chips are yellow.
- Resource inventory gives logos, names, and status indicators more room;
  environment chips and branch details are consistent across inventory and
  deployment lists.
- Overview deployment charts use separate colors tuned for light and dark
  themes. Server setup uses yellow progress indicators and calls its pending
  action Resume Setup.
- Account navigation adds a repository link and uses Sign out for its red
  action. Secret editors, branch controls, revision links, and tooltip borders
  have more consistent spacing and interaction states.
- The self-hosting and dashboard guides include refreshed release screenshots
  and current account, server-capacity, and deployment details.

### Fixed

- Switching detail sections keeps the secondary sidebar mounted, prevents
  identity images from flashing after text, and avoids a blank interval when
  opening deployment details.
- Deployment details keep their shell visible during loading and preserve the
  current snapshot during refresh. Links open the intended section directly.
- After server setup queues its first check, the setup page returns to Overview
  after five seconds.
- Tooltips that repeat their trigger appear only when text is clipped; long
  revision tooltips stay within the viewport. Secret-row connector lines are
  readable in both themes.

## [2.0.10] - 2026-09-24

### Added

- Notification history can be cleared from the header, and each notification
  opens the app, resource, server, or settings page that needs attention.
- The sidebar identity opens an account menu with profile, preferences,
  security, API keys, changelog, documentation, feedback, and sign-out actions.
- Server inventory shows CPU and memory utilization beneath capacity, with the
  measurement time available on hover and both capacity columns visible on mobile.
- Deployment lists and the overview's recent deployments show app or resource
  logos when available, plus the workload type beneath its name.
- Passkeys show their creation date beneath the name.

### Changed

- Deployment history gives requested time, branch, and commit their own table
  columns.
- Authentication panels use tighter padding on mobile screens.
- Deployment and resource overviews use clearer environment chips, simpler
  headings, a highlighted manual deploy action, and roomier mobile image names.
- Deployment comparisons use clearer assessment colors and a shorter navigation
  label; the status tooltip puts requested and finished times on separate lines.
- Overview illustrations have spring hover motion, and timestamp tooltips align
  to the left of their values.
- Repository onboarding uses tighter environment mapping rows, while inventory
  shows repository context in a branch tooltip instead of a separate column.
- Shared-secret empty states center the Add Variable action, and variable rows
  keep the delete control beside the name on desktop and mobile. Secret editors
  have tighter mobile spacing and desktop leader lines.
- Resource health-check settings have their own section. Cloudflare TLS shows
  its brand beside DNS mode and uses clearer validation copy; displayed domain
  names have a muted underline.
- Performance and incident filters sit in their page headers. Mobile performance
  filters and labels fit more cleanly, and Scout Agent setup uses clearer copy
  and more compact actions.
- The server terminal has a simpler layout and asks for confirmation before
  disconnecting. Completed setup checks no longer clutter server navigation.
- Widget headers use 22px buttons, widget footers use quieter descriptions,
  setup-step details use extra-small text, and `text-xs` is 0.72rem.
- Mobile small buttons are 28px tall with 12px horizontal padding; mobile tables
  size columns to their content, and page titles use a smaller inset.
- Credential and Cloudflare TLS widgets omit icons already present in their page
  headings. Popovers have a subtle edge, and the sidebar identity gradient
  appears only on desktop hover.
- The sidebar identity has more space between its labels, and sign-out
  confirmation shows an icon on its action button.
- Email senders include a display name, and message previews use complete
  sentences. The verification email has more space between its action and link.
- Notification integration settings identify configured routes and their
  destinations more clearly.
- Session revoke controls retain their label while a request is in progress;
  team member names no longer carry a redundant self label.
- Auto-deploy descriptions use normal weight, select controls reserve room for
  indicators, and editor tab labels stay stable while loading.

### Fixed

- Detail navigation keeps its loading state stable instead of briefly showing
  generic page titles, and cached product artwork no longer flashes during
  navigation.
- The sign-out action keeps its danger background visible without requiring
  hover, and Escape no longer closes the mobile sidebar.
- GitLab branch selectors load all available branch pages, including branches
  found by searching beyond the first page.
- Verification emails are dispatched promptly after being queued.
- System health reports the packaged release version and refreshes Temporal
  checks automatically instead of relying on manual checks.
- Safari reauthentication no longer prompts to save the password.
- Deployment chart date labels no longer clip, and mobile Actions headers align
  with their controls.
- The deployment queue and notification center render reliably through
  navigation and refreshes.

### Removed

- Repository-level shared secrets and `{{source.KEY}}` references. Reusable
  values now live in workspace Shared Secrets, while workload-specific values
  stay with each App or Resource.
- The verification dialog's request-limit explanation, failed environment
  discovery fallback copy, and redundant comparison-gap explanation.

## [2.0.9] - 2026-09-23

### Added

- First-deployment guidance now reports whether required app or resource
  secrets still need configuration and offers the next relevant action.
- Successful server setup immediately queues a health check so capacity and
  workload status refresh without waiting for the scheduled check.

### Changed

- Server Preparation is now named Server Setup throughout the dashboard and
  documentation.
- Resource Settings places Secrets before Backup and Restore, and Repository
  environment actions remain on one row on narrow screens.
- Secondary navigation counts use the same muted treatment as primary
  navigation counts.

### Fixed

- YAML-declared secret values can be cleared from their app or resource while
  preserving the declaration for later configuration.

## [2.0.8] - 2026-09-23

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

[Unreleased]: https://github.com/avgeek-inc/towbar/compare/v2.0.12...HEAD
[2.0.12]: https://github.com/avgeek-inc/towbar/compare/v2.0.11...v2.0.12
[2.0.11]: https://github.com/avgeek-inc/towbar/compare/v2.0.10...v2.0.11
[2.0.10]: https://github.com/avgeek-inc/towbar/compare/v2.0.9...v2.0.10
[2.0.9]: https://github.com/avgeek-inc/towbar/compare/v2.0.8...v2.0.9
[2.0.8]: https://github.com/avgeek-inc/towbar/releases/tag/v2.0.8
[2.0.7]: https://github.com/avgeek-inc/towbar/releases/tag/v2.0.7
[2.0.0]: https://github.com/avgeek-inc/towbar/releases/tag/v2.0.0
