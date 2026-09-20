# Launch feature completion audit

The requested scope includes control-plane backup and restore on S3, GCS and
Azure Blob; app persistent storage; manifest-defined scheduled app jobs; a
browser SSH terminal; team-level log drain integrations for New Relic, Axiom,
Better Stack, Datadog, OpenTelemetry and Loki; and deployment, uninstall and account recovery
documentation. Local verification is not production deployment evidence.

## Implemented and locally verified

- Persistent app volumes: manifest validation, Docker lifecycle and ownership
  tests, database isolation and server reassignment tests, Storage fixture UI,
  documentation, lint and type checks pass. The full non-root SSH deployment
  lifecycle also passes: files survive redeployment, failed-candidate recovery
  and restart with isolated production, staging and preview volumes.

- Scheduled application jobs: declare commands and UTC cron schedules in the
  app manifest; run against the current deployed image with runtime secrets,
  network and persistent mounts. Use the server coordinator to serialize with
  deployments. Record bounded, redacted output; enforce timeouts and prevent
  overlapping runs. No automatic retry of commands with unknown side effects.
  Verified with real Docker (non-root writes, mounted files, failure, timeout,
  bounded/redacted output and cleanup), PostgreSQL admission tests (duplicates,
  overlap, paused automation, stale configuration and role revocation), a real
  Temporal worker restart/history replay test, REST/MCP access tests, and the
  rendered fixture's confirmation, run history and output modal.
- Deployment model docs explicitly describe repository manifests, Dockerfile
  apps and image resources, without suggesting buildpacks or Compose import.

- Browser SSH terminal: Admin-only sidebar entry, one-use session-bound tickets,
  pinned host keys, live role/session/credential checks, PTY resize, bounded
  streams, idle/lifetime limits and connection audit events. Verified through
  a real Docker OpenSSH server and database-backed HTTP/WebSocket integration,
  including host-key mismatch, stale sign-in, replay and live role revocation.
  Fixture UI connection and command output verified visually.
- Host account recovery: Admin email/password recovery and any-user authenticator
  reset, optional passkey removal, stale-link/session/personal-key revocation,
  transactional audit/notifications. Real PostgreSQL tests pass. Added recovery
  and scoped uninstall guides; documentation links pass.

- Team Settings Backup and Restore: encrypted archives, UTC scheduling, S3/GCS/
  Azure adapters, authenticated browser-only administration, database-independent
  restore progress, and atomic PostgreSQL recovery. Verified against storage
  emulators with the real provider SDKs, PostgreSQL, the production image's PG17
  client, Temporal workflow isolation, HTTP authorization and desktop/mobile UI.
  Live cloud IAM/account configuration is not covered by emulator tests.

- Manifest log forwarding for apps and resources, with six provider credentials
  in Integrations. Credentials are encrypted, revealed only after recent Admin
  authentication, and absent from worker history. The forwarder reads the current
  deployed manifest, installs through pinned non-root SSH, uses bounded disk
  buffers, and removes itself before server removal. Restores pause forwarding
  until an administrator updates the integration.
  Real Vector Docker tests verify all six providers' HTTP payloads and headers,
  literal credentials containing `$`, metadata isolation and container selection.
  Real SSH tests verify permissions, idempotency, rotation, hardening and removal.
  PostgreSQL/HTTP tests verify team isolation, role restrictions, credential
  masking, deployed-release selection, restore pause and server removal. Worker
  restart/history replay and desktop/mobile form checks pass.
- Resource backup admission regression: GCS-only and Azure-only backups require
  only the selected team's configured provider. Missing selected credentials,
  multiple providers and cross-team credentials are covered with PostgreSQL.

## Final release checks

Repository-wide lint, type checks, unit and fixture tests, production builds,
API response/OpenAPI/MCP generation, and documentation links pass. The public
API/MCP PostgreSQL suite passes all nine access, ownership, role-change and rate
checks. The production API Docker image builds with PostgreSQL 17 client tools.
The final production-container dump/restore check passes, including atomic
rollback on failure and stale-access revocation. Interrupted log-forwarder
installation retains cleanup intent until remote removal is confirmed.

## Verification boundaries

- Storage provider SDKs were tested against local S3, GCS and Azure emulators.
  GCS emulator support does not cover object-generation preconditions. Actual
  cloud IAM, buckets and external provider accounts still require an operator's
  configured account check.
- Log forwarding HTTP contracts were checked against an isolated receiver.
  No live provider credentials or paid accounts were used. OTLP and Loki support
  configurable collector endpoints; hosted providers use their owned endpoints.
- Log forwarding is best-effort with bounded buffers. It forwards application
  output as emitted; applications remain responsible for not logging secrets.
- Control-plane backups contain the Towbar database, not app volume contents or
  target-server files. Persistent app volumes remain local to their server.
- This is local implementation and verification, not a deployed release.
