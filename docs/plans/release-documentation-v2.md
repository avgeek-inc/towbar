# V2 release documentation audit

Updated on 20 September 2026 against the `release/v2.0.0` checkout. This review covers the documentation source, generated API/MCP reference, contextual help destinations, and current light/dark fixture screenshots. It does not publish the hosted documentation or treat fixture data as production-provider evidence.

## Current product model

- The dashboard calls Git connections **Repositories**. Existing REST `/sources` paths and stable MCP identifiers retain their API names.
- Static integration credentials live in the API runtime environment. Towbar lists only providers whose enabled configuration passed startup validation. GitHub installation and GitLab OAuth authorization remain interactive because they create provider-side grants.
- Integrations, notification providers, notification deliveries, and log forwarding are grouped under **Manage → Integrations**. Shared secrets and System health remain in Manage; stored SSH keys live under **Team Settings → SSH keys**.
- The sign-out action is in the header beside the theme switcher. The sidebar footer contains the signed-in user and team identity.
- App Storage documents persistent volumes only. Towbar-managed backup and restore apply to supported database Resources.
- V2 is a fresh-install release. It does not support a 1.x database or manifest upgrade path.

## Guide coverage

| Area                         | Current coverage                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Getting started and concepts | First deployment, configuration ownership, Repositories, environments, apps, resources, servers, and deployments                                                           |
| Repositories                 | Provider connection, environment-to-branch mapping, manifest sync, automation controls, secrets, notifications, and removal                                                |
| Apps and Resources           | Runtime configuration, deployments, logs, secrets, app volumes/jobs, managed database backups/restores, and health                                                         |
| Servers                      | Registration, stored SSH keys, host-key trust, preparation checklist and logs, terminal, capacity, Scout, TLS, cleanup, and removal                                        |
| Monitoring                   | Incidents, vulnerabilities, performance, deployment comparisons, server/workload health, and control-plane System health                                                   |
| Integrations                 | Runtime environment contract for GitHub, GitLab, registry, backup providers, external secrets, Cloudflare, OpenTelemetry, notifications, and log forwarding                |
| Team and personal settings   | Admin/Member/Viewer access, members, invitations, audit history, API keys, SSH keys, profile, verified email change, sessions, authenticator, recovery codes, and passkeys |
| API and MCP                  | Authentication, permissions, localization, workflows, 136 REST operations, 53 MCP tools, and 183 response-handler schemas                                                  |
| Self-hosting                 | Installation, environment variables, architecture, account recovery, security, upgrades, uninstall, and fresh-v2 boundary                                                  |
| Reference                    | Root/app/resource manifests, platform modes, examples, environment variables, and generated OpenAPI/MCP pages                                                              |

## Screenshot evidence

Start the fixture API with `TOWBAR_FIXTURE_NOTIFICATION_PROVIDERS_CONFIGURED=true pnpm --filter towbar-web-app dev:fixture-api`, then run `pnpm docs:screenshots`. The capture validates that the notification fixture is enabled before opening Chrome. It sets the theme before navigation, uses a 1280 × 720 CSS-pixel viewport, captures long pages up to 8,000 pixels, opens the incident-detail fixture where required, and rejects 404 pages, Next.js runtime overlays, and failed-query states.

The manifest at `docs/plans/release-v2-screenshots.json` records 28 named routes with light and dark images (56 JPEGs). The capture updates each guide's intrinsic image dimensions. `pnpm docs:check` then verifies canonical routes, both themes, JPEG dimensions, file existence, and that every declared guide references both images. The refreshed contact sheet was visually reviewed for light/dark rendering, navigation, clipping, and error states.

## Verification

- `pnpm docs:check`: 186 pages pass metadata, navigation, redirects, internal links, contextual-help destinations, screenshot themes, and intrinsic dimensions. Published schema/example artifacts are in sync.
- `pnpm docs:api:check`: 136 OpenAPI operations, 53 MCP tools, and 183 response-handler schemas match the current implementation and report version 2.0.0.
- The web app and shared design system pass TypeScript and lint after the shared popover trigger, controlled modal/drawer, integration catalogue, and documentation-link changes.
- Fresh screenshot capture completed for all 56 images with no route 404, runtime overlay, or failed-query view.

## Acceptance boundary

The fixture proves page contracts and presentation. It does not prove a real GitHub or GitLab grant, cloud IAM, object-storage restore, SMTP inbox delivery, public certificate issuance, physical WebAuthn prompt, long-running VM resource behavior, or hosted documentation deployment. Those checks remain explicit release-operator acceptance tasks and must not be inferred from screenshots.
