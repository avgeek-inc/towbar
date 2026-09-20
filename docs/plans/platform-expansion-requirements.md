Implement Towbar’s next platform expansion end to end, bringing the requested capabilities close to Coolify and Dokploy while preserving Towbar’s manifest-first model, existing architecture, security boundaries, and design system.

This is an implementation goal, not only a planning exercise. Begin with a concrete implementation plan and dependency-ordered milestones, then execute the work through verification and documentation. Do not stop after scaffolding, UI mockups, happy-path tests, or an initial subset.

Work in the current Towbar repository and preserve unrelated changes. Inspect the actual implementation and installed dependencies before relying on earlier plans or audit reports.

Read the existing manifest, access-control, release-verification, deployment, backup, and observability documentation. Treat historical verification as context, not proof that the current tree passes.

PRODUCT PRINCIPLES

1. Repository manifests remain the source of truth for workload configuration:
   - Build/deployment type, source configuration, build server, rollout strategy, runtime settings, storage, backup policies, secret references, observability, and ingress belong in manifests.
   - Referenced Compose files and builder configuration files must come from the same immutable repository revision.
   - The UI explains, validates, previews, and operates the declared configuration.
   - Do not create a second UI-only workload configuration model that can drift from Git.

2. Integration credentials are configured once in Towbar:
   - Git providers, registries, object storage, external secret managers, telemetry destinations, and Cloudflare credentials belong in Integrations.
   - Manifests reference stable, human-readable integration identifiers.
   - Allow multiple named connections for a provider where needed.
   - Never put secret values in manifests.
   - Team authentication policy and identity-provider configuration belong under Team Settings, reusing the shared encrypted credential infrastructure.

3. Reuse the existing API, database, Temporal workflows, deployment primitives, authorization model, audit system, notifications, and design system.
   - Introduce shared provider interfaces where useful.
   - Avoid duplicated business logic across UI, REST, MCP, workers, and command-line utilities.
   - Prefer maintained official SDKs and established libraries over custom protocol implementations.
   - Record dependency version, maintenance, licensing, architecture compatibility, and security considerations.

4. Preserve the clean-break release policy:
   - No 1.x compatibility work is required.
   - If this remains part of the unreleased clean-break version, consolidate the initial schema as agreed before merge.
   - Do not reset an existing user database or rewrite a schema already shipped to users.
   - Verify the current release state before choosing migration handling.

5. Preserve existing least-privilege behavior:
   - Admin, member, and viewer permissions remain deliberate.
   - Adding a provider, build method, Compose file, or secret reference must not create a route around RBAC.
   - Revalidate authorization when queued operations execute.
   - Role changes and deprovisioning must immediately affect sessions, personal API keys, MCP access, and queued user-authorized work.

REQUIRED CAPABILITIES

1. GITLAB SUPPORT

Implement GitLab.com and self-managed GitLab repository connections.

Include:

- In-product credential configuration, connection testing, token refresh where applicable, revocation, disconnect, and reconnect.
- Repository/group discovery, pagination, branch selection, and named environment mapping.
- Immutable commit resolution and archive/file retrieval.
- Push-triggered deployments and merge-request previews.
- Deployment status feedback, commit links, manifest links, and merge-request comments where supported.
- Preview cleanup on merge, closure, expiry, or configuration removal.
- GitLab-compatible webhook authentication, event validation, replay protection, deduplication, and out-of-order event handling.
- Rate-limit handling and actionable permission/token-expiry errors.
- Safe self-managed base-URL validation and explicit private-network connection policy.

Create a shared Git-provider abstraction without weakening existing GitHub behavior.

Keep fork/untrusted-contribution execution disabled by default. Do not expose production credentials to previews or execute untrusted repository code on the control-plane host.

Verify GitHub and GitLab coexist, including repositories with identical names under different providers or namespaces.

2. STATIC, IMAGE, NIXPACKS, RAILPACK, AND BUILDPACK DEPLOYMENTS

Extend the manifest schema with an explicit, mutually exclusive deployment/build type.

Support:

- Existing Dockerfile builds.
- Static sites.
- Prebuilt OCI images.
- Railpack.
- Nixpacks.
- Cloud Native Buildpacks through a maintained implementation such as pack, with validated Paketo/Heroku builder options.

For static sites:

- Support both prebuilt assets and a declared build command/output directory.
- Package assets into a reproducible serving image.
- Support SPA fallback, index/error handling, cache/header configuration, domains, TLS, and health checks.
- Prevent output paths from escaping the declared build context.

For image deployments:

- Support public and private registries.
- Store registry credentials in Integrations.
- Resolve tags to immutable digests at deployment admission.
- Record architecture, digest, provenance available from the source, and release identity.
- Verify digest-based redeploy and rollback.

For source builders:

- Support build context, builder version/image, build/start commands, supported builder configuration files, cache configuration, architecture, and resource limits.
- Prefer Railpack in examples and recommendations.
- Keep Nixpacks as an explicitly supported compatibility option.
- Pin tools and builder images; do not silently consume changing latest versions.
- Distinguish ordinary build arguments from secret mounts.
- Prevent credentials from entering image layers, build output, or cache shared across unauthorized scopes.
- Respect cancellation, timeouts, cleanup, and server concurrency.

Ship validated example applications for every supported mode.

3. DOCKER COMPOSE SUPPORT

Add manifest-declared Compose workloads.

Support:

- A repository Compose file plus explicitly declared override files.
- Service discovery, supported profiles, dependencies, health checks, networks, named volumes, environment values, and secret references.
- Service-specific domains, ingress, log forwarding, and observability.
- Buildable services and image-based services.
- Environment and preview isolation.
- Stack/service status, logs, deployment history, start, stop, redeploy, cleanup, and recovery.

Use the Compose specification and maintained tooling instead of reimplementing YAML interpolation and merge semantics.

Define and document the supported feature matrix.

Reject unsupported or unsafe options with precise errors before changing the server. Do not silently ignore options.

In particular:

- Namespace managed containers, networks, and volumes.
- Prevent arbitrary access to the Docker socket, control-plane files, host devices, or privileged host namespaces.
- Keep managed named volumes as the default persistence model.
- Require explicit privileged policy for any advanced host-level capability; do not implicitly grant it through repository write access.
- Do not resolve env_file, include, build contexts, or other paths outside the authorized repository/configuration boundary.
- Do not accept arbitrary remote includes by default.
- Preserve persistent data during failed deployment and ordinary cleanup.

Explain and test which Compose service combinations support rolling replacement and which require an explicit recreate/maintenance strategy.

4. ROLLING DEPLOYMENTS AS THE STANDARD

Make health-gated, start-first rolling replacement the default for eligible stateless services.

Implement:

- Desired replica count where supported.
- Readiness checks, startup deadlines, minimum healthy duration, and failure thresholds.
- Maximum surge/unavailable controls with validated defaults.
- Resource/headroom preflight.
- Safe traffic switching and connection draining.
- Graceful shutdown and termination timeout.
- Automatic rollback when candidate readiness or promotion fails.
- Deterministic handling of cancellation, concurrent deployment, worker restart, and partial promotion.
- Release-level logs and a clear UI timeline.

For a single replica, retain the healthy old instance until its replacement is ready and traffic is switched.

For multiple replicas, replace instances in bounded batches while respecting availability constraints.

Do not claim that rolling deployments provide cross-server HA.

Do not silently perform unsafe overlapping execution for:

- Managed databases.
- Single-writer volumes.
- Singleton workers or scheduled jobs.
- Fixed host ports.
- Incompatible Compose services.
- Non-backward-compatible schema changes.

Require an explicit manifest strategy for workloads that need recreation or maintenance downtime. Show the reason and impact before deployment.

Keep schema-migration hooks explicit. Application rollback must not pretend it can reverse arbitrary database migrations.

5. BUILD SERVER IP IN THE MANIFEST

Allow manifests to declare a build server IP separately from the runtime server IP.

The IP must resolve to an already registered, authorized server with verified SSH identity and a prepared build capability. Never interpret it as permission to connect to an arbitrary host.

Support:

- Repository/environment defaults and an app-level override with documented precedence.
- IPv4/IPv6 canonicalization and ownership validation.
- Build-server preparation/status and capability checks.
- Architecture compatibility and explicit handling of cross-platform builds.
- Independent build concurrency, cache limits, disk cleanup, and resource limits.
- Clear attribution of build stages versus runtime deployment stages.

Support secure artifact transfer:

- Direct authenticated image transfer as a registryless path where practical.
- Configured registry push/pull when selected.
- Digest verification at the runtime target.
- Short-lived access and cleanup of credentials and temporary artifacts.

Fail clearly if an explicitly selected build server is unavailable. Do not silently run the build on the production runtime server unless the manifest explicitly permits fallback.

6. APPLICATION VOLUME BACKUP AND RESTORE

Implement actual backup and restore for managed application volumes, including managed Compose volumes.

Include:

- Manual and scheduled backups.
- Manifest-defined destination, selected volumes, schedule, retention, exclusions, and consistency policy.
- Reuse of storage Integrations.
- Encrypted archives/repositories, integrity verification, compression, streaming, and bounded resource use.
- A manifest describing application/environment, volume identity, format, timestamps, ownership, and compatibility.
- Backup history, progress, cancellation where safe, sanitized logs, notifications, and restore status.

Make consistency explicit:

- App-aware pre/post hooks or quiescence.
- Stop-and-backup mode where required.
- Crash-consistent mode only when explicitly selected and clearly labeled.
- Do not call an archive of a live database volume an application-consistent backup.

For restore:

- Default to a fresh volume or recovery target.
- Validate credentials, archive integrity, destination capacity, paths, ownership, and compatibility before cutover.
- Protect against path traversal, unsafe symlinks, decompression bombs, and unexpected volume targets.
- Preserve the current data until restored data passes validation.
- Require deliberate confirmation for replacement of active data.
- Retain a defined recovery path if cutover fails.
- Restore to another authorized server where compatible.

Test complete recovery after deleting the disposable source runtime and volume, not only archive creation.

7. EXPANDED MANAGED DATABASE ENGINES

Support the union of the requested Coolify/Dokploy engines:

- PostgreSQL
- MySQL
- MariaDB
- MongoDB
- Redis
- Dragonfly
- KeyDB
- ClickHouse

Each engine must have a real managed lifecycle, not just a generic container preset.

Implement:

- Version/image selection with a published compatibility matrix.
- Validated configuration and encrypted credentials.
- Private networking by default.
- Readiness, health, resource limits, persistent storage, logs, and useful metrics.
- Safe connection information and secret references.
- Manual/scheduled engine-aware backup.
- Verified restore to a fresh target and controlled replacement.
- Retention, progress, cancellation semantics, history, and failure notifications.

Use the engine’s supported logical backup or snapshot mechanism.
Do not assume Redis-compatible engines have interchangeable persistence formats.
Do not promise online consistency where the engine/tooling cannot provide it.

Test representative data, authentication, restart persistence, backup integrity, corruption rejection, restore failure, and successful recovery for every engine.

Document supported source/target versions and any required downtime.
Do not automatically perform major-version database upgrades.
Keep PITR, clustering, replication, and cross-engine conversion separate from the baseline unless explicitly implemented and verified.

An engine is not complete until its documented backup AND restore path passes.

8. CLOUDFLARE R2 AND S3-COMPATIBLE BACKUPS

Extend object-storage Integrations to support:

- AWS S3.
- Cloudflare R2.
- Generic S3-compatible storage, including MinIO-compatible deployments.
- Existing GCS and Azure behavior.

Support named connections with:

- Endpoint, region, bucket/prefix defaults, authentication, addressing style, and supported TLS/custom-CA settings.
- Provider-aware validation.
- A connection test that can validate the permissions required by the selected backup policy.
- Multipart transfer, retry, checksum handling, interrupted-upload cleanup, and retention.
- Capability detection or clear validation for API features a provider does not support.

Do not treat R2 as identical to every AWS S3 capability.
Do not weaken certificate validation to support custom endpoints.

For private object-storage endpoints, use an explicit admin-configured network policy. Block metadata endpoints and unintended local/control-plane access.

Apply these destinations consistently to database backups, application-volume backups, and control-plane backups.

9. ENTERPRISE IDENTITY (DEFERRED)

Enterprise identity is outside the v2.0.0 scope. The release must not expose OIDC, SAML or SCIM configuration, protocol endpoints, provider contracts, dependencies or persistence objects.

10. EXTERNAL SECRET SOURCES

Support Infisical and Doppler as sources for application/resource environment variables, including Compose services.

Credentials are managed centrally in Integrations.

Manifest references must identify:

- Integration.
- Provider-specific secret identifier/path.
- Optional JSON field.
- Optional version/stage.
- Intended runtime or build-secret use.

Include:

- Multiple named connections and environment-specific scope.
- Permission-aware validation.
- Deployment-time resolution into a consistent secret snapshot.
- Version identifiers recorded without storing plaintext in deployment metadata.
- Retry behavior that does not change secret versions halfway through one deployment.
- Explicit refresh/rotation and redeployment behavior.
- Clear precedence between literal values, Towbar-managed secrets, shared references, and external references.
- Fail-closed behavior when a required value cannot be resolved.

Never expose secret values in manifests, previews, API responses, MCP output, logs, audit events, build layers, or Temporal history.

Use protected temporary storage only where execution requires it, with strict permissions and cleanup.
Treat secret-name/path metadata as potentially sensitive.

Do not let repository writers reference an integration or secret namespace outside their authorized scope.
Use native identity/short-lived credentials where supported; do not require copied long-lived credentials unnecessarily.

11. MCP FEATURE PARITY

Implement MCP alongside every capability, not as a final afterthought.

For each feature, provide appropriate tools for:

- Discovery and configuration inspection.
- Manifest/configuration validation and deployment planning.
- Authorized configuration changes.
- Starting operations.
- Reading progress, sanitized logs, outcomes, and history.
- Cancellation and recovery where supported.

Use the same service layer, role rules, integration scopes, and operation policies as REST/UI.

Require additional explicit administrative permissions for identity configuration, patching, restore, integration management, or similarly sensitive operations.
Never interpret a generic edit key as unrestricted infrastructure authority.

Return operation IDs for asynchronous actions.
Support idempotent invocation and bounded/paginated output.
Never return stored credentials or bypass interactive authentication/recovery safeguards.

Document narrowly justified browser-only security ceremonies such as password/MFA challenges.
Maintain a feature-to-UI/REST/MCP parity matrix; do not silently omit management capabilities.

Generate schemas, API documentation, and MCP contracts from shared definitions where possible.

13. OTLP EXPANSION

Expand from log forwarding to a complete telemetry collection/export path for:

- Logs.
- Metrics.
- Traces.

Use a maintained OpenTelemetry Collector distribution instead of implementing OTLP protocols manually.

Support:

- OTLP HTTP and gRPC reception/export where appropriate.
- Central destination credentials and per-workload manifest opt-in.
- Explicit app instrumentation settings; do not claim automatic tracing for uninstrumented applications.
- Standard resource attributes identifying team, repository, environment, app/resource, deployment and server.
- Trace/log correlation when trace IDs are present.
- Batching, bounded memory, persistent queues where appropriate, retry, compression and timeouts.
- Sampling controls, sensitive-attribute redaction and cardinality limits.
- TLS, authentication, network isolation and cross-team boundaries.
- Per-signal failure isolation and visible queue/drop/backpressure metrics.
- Compatibility with existing Scout metrics and log drains without duplicate export.

Add UI for configuration, pipeline health, delivery failures and links to the configured observability backend.

The baseline goal is collection, processing and export of all three signals. It does not require building a new unlimited telemetry database or full APM query product inside Towbar.

Verify all three signals against a real collector/backend test stack, including failure, restart, backpressure and resource-isolation cases.

14. CLOUDFLARE TUNNEL

Add Cloudflare Tunnel as a manifest-selectable ingress option.

Implement:

- Cloudflare account/zone permissions and credentials in Integrations.
- Managed tunnel creation or attachment with explicit ownership.
- Pinned cloudflared installation, health checks, restart/reconnect and token rotation.
- Hostname/service routing derived from manifests.
- Safe route updates and removal.
- Preview hostname lifecycle.
- Compatibility with Towbar’s local proxy and rollout traffic switching.
- Clear status, logs, diagnostics and notifications.

Do not publish application ports directly as a side effect of selecting Tunnel.
Do not delete tunnels or DNS records that Towbar does not own.

Distinguish:

- Public application routing through Tunnel.
- Cloudflare Access protection.
- Administrative SSH connectivity.

Tunnel ingress must not silently enable remote administration or imply that the server no longer needs a verified management connection.

Verify outbound tunnel operation, route isolation, reconnect, deployment cutover and ownership-safe cleanup.
Use a live disposable Cloudflare configuration only when the required account access is explicitly available.

15. SERVER PATCHING WORKFLOW

Add an administrator-only server patching section and durable workflow for supported operating systems.

Support:

- Refreshing available updates.
- Security-only or explicitly selected updates where the OS supports them.
- Package/version change preview.
- Maintenance windows and optional scheduling.
- Reboot-required detection.
- Separate explicit policy for reboot.
- Clear handling of Docker, proxy and other updates that may restart workloads.
- Preflight checks for SSH trust, disk space, package-manager locks and current server health.
- Coordination with deployments, builds, backups and restores.
- Bounded command execution, progress, sanitized terminal logs, history and notifications.
- Recovery from lost SSH connections and worker restarts.
- Post-update connectivity, Docker, proxy, Scout, tunnel and workload health verification.

Do not automatically perform distribution upgrades or database major upgrades.
Do not promise automatic package rollback where the package manager cannot provide it.
Explain expected impact and the available recovery procedure before execution.

Test using disposable VMs suitable for package updates and reboot verification; a container-only simulation is not enough to claim reboot support.

SHARED IMPLEMENTATION REQUIREMENTS

Manifest and configuration:

- Design a coherent versioned schema before scattering feature-specific fields.
- Keep discriminated build/deployment types and explicit capability validation.
- Reuse environment override rules and immutable revision snapshots.
- Provide precise file/path/field validation errors.
- Reject unsupported combinations before server changes.
- Keep generated JSON schemas, examples, fixtures and documentation synchronized.

Durable operations:

- Every long-running action needs persistent stages, logs, terminal outcomes, idempotency, bounded retries, timeout and cancellation semantics.
- Coordinate competing operations through existing workload/server locks or queues.
- Reconcile actual external state after worker restart or uncertain provider responses.
- Define compensating actions for partial success.
- Never put credentials or resolved secrets in durable workflow payloads/history.

Security:

- Audit new data flows and trust boundaries.
- Test cross-team, role, API-key, MCP and queued-operation isolation.
- Protect against SSRF, path traversal, shell injection, archive attacks, webhook forgery, token replay and secret leakage.
- Treat repository/build/Compose configuration as executable input from its authorized trust boundary.
- Pin downloaded binaries/images and verify their origin/integrity.
- Preserve host-key pinning and TLS verification.
- Bound public/auth/telemetry endpoints and expensive operations.

UI/UX:

- Use the existing design system, compact table actions and consistent two-line cell spacing.
- Reuse provider logos, status chips, required markers, accessible secret inputs and shared forms.
- Avoid tables nested inside decorative widgets.
- Make loading, empty, permission-denied, failed, disconnected and recovery states intentional.
- Show actual progress rather than only “queued.”
- Keep sensitive credentials in their shared configuration locations.
- Provide accessible keyboard interaction, predictable focus, responsive layouts and useful errors.
- Preserve the established sidebar and contextual status conventions.

EXECUTION ORDER

Create a dependency-based plan with these broad milestones, refining boundaries as needed:

A. Current baseline, architecture, schema, shared integration capabilities and required CI gates.
B. GitLab, registry support, build adapters and separate build servers.
C. Rollout engine and Compose lifecycle.
D. Object-storage expansion, application-volume recovery and all managed database engines.
E. External secret sources.
F. OTLP expansion, Cloudflare Tunnel and server patching.
G. Cross-feature resilience, security, UX, documentation and release-readiness review.

MCP, authorization, tests, fixtures and documentation are part of every milestone.

For each milestone, complete a vertical slice through schema, database, service layer, workflow/runtime, UI, REST/MCP, fixtures, tests and docs before claiming it complete.

Maintain a progress document containing:

- Decisions and reasons.
- Completed acceptance criteria.
- Exact verification commands and outcomes.
- Remaining defects.
- External prerequisites.
- Any deliberate unsupported combinations.

Do not silently reduce scope. If an upstream limitation blocks a requirement, record the evidence, implement the safest achievable behavior, and identify the concrete decision needed.

VERIFICATION AND DEFINITION OF DONE

1. All required code-quality, schema, API/MCP contract and documentation gates pass.
2. Clean production images build and a fresh production stack starts successfully.
3. Meaningful integration/lifecycle suites run in required CI; mandatory coverage must not silently skip because an environment variable is absent.
4. Every build mode produces and deploys a real image or static application.
5. GitHub and GitLab push/preview/reconnect/cleanup paths are covered.
6. Rolling deployment tests include traffic during rollout, failed readiness, draining, insufficient capacity, cancellation and worker restart.
7. Compose tests include multi-service dependencies, stateful volumes, failed partial updates and cleanup isolation.
8. Every managed database engine passes a real backup-and-restore round trip with representative data.
9. Application-volume recovery is demonstrated after source-volume loss.
10. Storage-provider tests cover multipart operations, corruption, retention and permissions; real external checks are separately identified.
11. Enterprise identity entry points and protocol routes are absent from the v2.0.0 UI and API.
12. External secret tests cover version consistency, denied scope, rotation, provider outage and leakage prevention.
13. Logs, metrics and traces are verified end to end with bounded-resource failure tests.
14. Tunnel routing and server patch/reboot claims have appropriate real-system evidence.
15. UI verification covers desktop/mobile, keyboard use and representative error/recovery states.
16. Dependency/security findings are resolved or explicitly documented with a defensible release decision.
17. Existing Towbar behavior is regression-tested.
18. Provide practical user documentation and validated manifest examples for every new capability.

Use disposable local infrastructure for destructive testing.
Do not modify production servers, real identity-provider policies, live DNS, production backups or customer data merely to complete verification.

When external access is unavailable:

- Complete local and protocol-level testing.
- State exactly what remains unverified.
- Provide a concise acceptance procedure.
- Do not substitute fixtures or mocks for claims of live-provider completion.

Finish with:

- A feature-by-feature completion table.
- UI/REST/MCP coverage.
- Test evidence and CI coverage.
- Supported version/provider/architecture matrices.
- Known limitations and operational recovery procedures.
- Remaining release blockers.
- An updated comparison with the requested Coolify/Dokploy capabilities.

Continue through implementation and verification rather than stopping at the plan. Do not publish a release or deploy to production unless separately instructed.
