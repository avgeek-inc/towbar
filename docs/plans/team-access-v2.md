# Towbar v2 team, authentication, and access plan

Status: implemented and verified locally on 16 September 2026. See `team-access-v2-progress.md` for implementation decisions, verification evidence and deployment boundaries.

This draft supersedes the earlier team plan. Towbar v2 does not support a 1.x database. Build the final schema directly, without role aliases, data backfills, or compatibility paths. Consolidate the complete schema into the agreed `001` baseline before merge; the migration runner's filenames and journal must agree. Validate against disposable fresh databases. The planned reset does not authorize deletion of an arbitrary existing local or hosted database.

## Product decisions

- One team per Towbar installation for this release. Use the existing workspace tenancy concept and IDs; present it as Team in the product.
- Roles are exactly `admin`, `member`, and `viewer`. The onboarding user becomes an admin. There is no separate owner role or global user-admin role.
- Onboarding collects team name, name, email, password, and confirmation. Team description is edited later.
- Personal Settings retains Profile and Sessions. Team Settings has Members first, then General.
- Admins manage membership, invitations, integrations, notification configuration, infrastructure, private keys, and team API keys.
- Members manage repositories, update application/resource secrets and shared secrets, configure Scout Agent, and create their own API keys.
- Viewers have read-only access to non-sensitive operational views. They can manage their own profile, password, MFA, sessions, personal notification inbox, and read-only personal API keys; they cannot change shared team resources or configuration.
- Interpret repository management as configuration and inventory management. It does not automatically confer deployment, server execution, or cleanup authority.
- Ordinary operational views remain available to members and viewers: repository/app/resource inventory, deployment history and status, monitoring, incidents, vulnerabilities, and redacted logs. Authentication does not grant access to credential values, unredacted diagnostic exports, or other users' personal settings.
- This plan interprets the earlier reference to public KPI as public API.

## Recommended changes to the earlier plan

1. Prefer invitations as the main onboarding path for additional users. Retain Add user with a temporary password for instances without working email. Require replacement of that password on first login; never email it.
2. Require mailbox verification for invitation acceptance. A fixed email field and an invite URL shared outside email do not establish mailbox ownership. Copy link remains available, but an unverified recipient must complete verification through SMTP before joining. Directly provisioned accounts are a separate administrator-attested path and must not be marked email-verified automatically.
3. Separate secret updates/references from reveal/export. Members can change values and use shared-secret references; revealing stored values is an explicit admin permission by default. Shared secrets means reuse within the team, not public sharing links.
4. Authorize repository operations by their effects. The current environment sync route sets `deployAfterSync: true`; simply granting that route to members would grant deployment indirectly. Branch mappings, previews, server revival, archival, and automatic deployment paths need the same review.
5. Treat team keys as service identities. Creator information is attribution, not their continuing authority. Personal keys remain constrained by a live membership; team keys retain the explicit permissions an admin granted until revoked.
6. Preserve three UI roles while describing permissions as resource/action pairs. Use one evaluator everywhere, with workspace and ownership checks in addition to role checks. Viewer means read-only team access; it does not prevent users from securing their own accounts.
7. Include password recovery and optional authenticator-app MFA with recovery codes. Recommend MFA for admins; compulsory enrollment and enterprise SSO are separate future policy decisions.
8. Protect initial setup with a single-use code issued to the installer. A fresh instance reachable on the public internet must not award the first admin account to whoever submits the setup form first.

Least privilege, denial by default, request-time checks, and resource ownership checks follow [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). The particular Admin/Member/Viewer split above is a Towbar product choice.

## Library recommendation

Use Better Auth for authentication, its organization/access-control support for membership primitives and role evaluation, and its API Key plugin for token mechanics. Keep Towbar's application permission policy in a small shared package. Use React Email for rendering and the existing Nodemailer SMTP transport for delivery.

Better Auth documents [Hono integration](https://better-auth.com/docs/integrations/hono) and a [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle). Its [organization plugin](https://better-auth.com/docs/plugins/organization) supports member/invitation operations, custom permissions, and an admin creator role. Its [API Key plugin](https://better-auth.com/docs/plugins/api-key) supports both user and organization ownership. These are library capabilities, not proof that its default configuration enforces Towbar's policy.

Do not introduce a second authentication system alongside Better Auth. Replace the existing password-session implementation after the integration proof succeeds. Keep Towbar's credential encryption facilities for SSH keys and provider secrets; those are separate from login credentials.

CASL is a credible alternative if future permissions depend on individual repositories, environment attributes, or object fields; it is an [isomorphic authorization library](https://github.com/stalniy/casl). [Casbin](https://www.casbin.org/docs/rbac) is another option for policy models and role hierarchies. Neither is needed alongside Better Auth's access-control evaluator for this three-role version. No library removes the need to define Towbar's permission rules or enforce tenant isolation in queries.

### Integration proof before broad refactoring

Pin a compatible stable set of Better Auth packages after checking releases, license, advisories, and Node/Drizzle compatibility. Do not copy APIs from a different release of the docs. Prove the following with the installed version before finalizing schema generation:

- Email/password sign-in and sign-out through Hono with the existing web/API deployment origins and cookies.
- Database sessions, revocation, password reset, MFA enrollment/challenge, and recovery codes.
- Organization creator role `admin`, only the three allowed roles (`admin`, `member`, `viewer`), and no user-created second organization.
- Invite-gated account creation, mailbox verification, and existing-account acceptance without changing the existing password.
- Personal and organization API keys, with API-key session emulation disabled.
- Transaction boundaries for bootstrap, last-admin changes, invitation acceptance, and key-policy creation.
- The raw library endpoints cannot bypass Towbar's wrapper policies. Enumerate allowed auth endpoints and reject unused enrollment, organization, key, and global-admin paths.

Use the organization schema as the canonical workspace/member/invitation storage through adapter mapping. Do not maintain duplicate membership tables. Put the last-admin and role/key update operations in a transaction with a common workspace lock; independent before/after hooks are not a concurrency guarantee. If a library operation cannot participate safely, use a narrow transaction service against the same mapped schema, retaining library authentication primitives. Record any material change to this recommendation before expanding implementation.

## Authorization contract

Create `@workspace/towbar-access` as a small package usable by API and web code without pulling server auth or database code into browser bundles. Define explicit resources and actions, roles, API permission presets, and human-readable descriptions. The package uses the chosen access-control evaluator; request/resource lookup remains in the API.

| Surface/action                                                                 | Admin session                                 | Member session                          | Viewer session |
| ------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------- | -------------- |
| Operational inventory, status, monitoring, redacted logs                       | Yes                                           | Yes                                     | Yes            |
| Connect repository using an existing GitHub installation                       | Yes                                           | Yes                                     | No             |
| Change repository mappings, sync inventory, disconnect without runtime cleanup | Yes                                           | Yes, subject to the effects rules below | No             |
| Deploy, rollback, cancel deployment, start/stop/restart workloads              | Yes                                           | No                                      | No             |
| Prepare, trust, clean up, remove, or edit server connection settings           | Yes                                           | No                                      | No             |
| Backup/restore and destructive resource operations                             | Yes                                           | No                                      | No             |
| Update declared app/resource secret values                                     | Yes                                           | Yes                                     | No             |
| Create/update shared secrets and link references                               | Yes                                           | Yes                                     | No             |
| Reveal/export stored secret values                                             | Yes                                           | No                                      | No             |
| Scout status and non-sensitive monitoring configuration                        | Yes                                           | Yes                                     | Read-only      |
| Scout install/configure/update/uninstall using Towbar's fixed workflow         | Yes                                           | Yes                                     | No             |
| Create/update/delete Scout alert rules                                         | Yes                                           | Yes                                     | No             |
| Provider credentials, GitHub App setup, notification routes                    | Yes                                           | No                                      | No             |
| SSH private-key storage/reveal and server-key attachment                       | Yes                                           | No                                      | No             |
| Own profile, password, MFA, sessions, personal notification inbox              | Yes                                           | Yes                                     | Yes            |
| Own personal API-key creation/revocation                                       | Read-only or Edit; optional admin permissions | Read-only or Edit                       | Read-only only |
| Members, invitations, team name/description, team keys                         | Yes                                           | No                                      | No             |
| Control-plane system diagnostics and instance-wide actions                     | Yes                                           | No                                      | No             |

Scout permission must not expose SSH credentials, arbitrary commands, custom executable URLs, or unrelated server configuration. Reuse trusted server credentials internally within the fixed Scout workflow.

For secrets, retain manifest-owned declarations and editable Towbar values. File mode must preserve unchanged masked values and references explicitly; submitting a mask must never replace a stored secret. No bulk-reveal fallback for members or viewers. Viewer operational reads may include non-sensitive manifest declarations, but never resolved secret values, shared-secret contents, or secret-management endpoints.

Example actions include `repository.read/connect/update/sync/disconnect`, `deployment.create/cancel`, `server.prepare/credentials/update/remove`, `secret.list/update/reveal`, `sharedSecret.list/update/reference/reveal`, `scout.configure`, `integration.manage`, `notification.manage`, `privateKey.manage/reveal`, `member.manage`, and `team.update`. Sensitive GET requests get explicit permissions; HTTP method is not the access policy.

### Repository and asynchronous effects

- Member sync produces an inventory/configuration snapshot and does not request deployment. The UI and response accurately describe that outcome.
- Carry a server-derived actor and permitted effect set into queued work. Revalidate personal membership and key policy before starting a privileged effect; never accept capabilities from request JSON.
- Reconciliation may reflect manifest inventory. It must not prepare/revive server management, remove runtime data, start preview cleanup, or enqueue a deployment without the corresponding authority. Separate those effects from snapshot reconciliation where they are currently combined.
- A member changing a branch, connecting/reconnecting an environment, or changing a preview target must not silently repoint enabled deployment automation. Clear/pause runtime automation for that changed configuration until an admin explicitly enables it. This is the existing automation control, not a new approval system for every Git commit.
- Existing admin-enabled GitHub automation is a distinct system principal, bound to its configured repository/environment and revision. A member's manual request must not be relabeled as a webhook/system request.
- Document that people who can push executable code to an already automated branch can influence workloads through Git. Towbar UI RBAC cannot replace GitHub branch protection or make arbitrary deployed code safe.
- A role change affects new admissions and subsequent authorized effects. Do not abruptly abandon a running destructive step; finish or cancel at a defined safe boundary and audit it.

### Request enforcement

Replace `ownerOnly` in `http/operation.ts` with required resource/actions, allowed actor types, and explicit external exposure. Every protected operation declares a policy; missing metadata fails closed and fails a contract test.

Introduce an actor union: user session, personal API key, team API key, and internal system actor. A team key must not invent a human user ID. Retain user attribution when present, add API-key attribution to audits and queued operations, and update existing `requestedBy` assumptions.

Public setup, invite preview, sign-in/recovery, GitHub webhooks, Scout ingest, and internal worker APIs require their own explicit authentication policies. They do not use a human team role. Their scope is narrow and cannot be selected by a user bearer key.

Use one authoritative function for session middleware, REST dispatch, MCP tool discovery/invocation, and service actions. All resource queries still constrain `workspaceId` and parent IDs. The UI receives capabilities from the server; hidden controls are not authorization.

Keep authority out of cached session claims. Better Auth's [session documentation](https://better-auth.com/docs/concepts/session-management) notes that cookie caching can delay revocation; disable it for this installation's control plane and resolve live membership/policy on protected requests. Revalidate bounded streams and MCP calls so a revoked identity cannot continue indefinitely.

## Final schema shape

Generate Better Auth's required schema for the pinned configuration into the Towbar Drizzle package, then review and map it to the application tables before producing the fresh baseline.

| Model                             | Application requirements                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User/account/session/verification | Library-managed auth data; unique normalized email; display name; email-verification state; disabled state; forced-password-change state where applicable                                               |
| Workspace/organization            | UUID, name, stable internal slug, nullable description, timestamps; one installation workspace                                                                                                          |
| Membership                        | UUID if required by library, workspace/user foreign keys, role restricted to admin/member/viewer, timestamps, unique workspace/user membership                                                          |
| Invitation                        | Workspace, normalized recipient, role restricted to admin/member/viewer, inviter, status, expiry, timestamps; one active invitation per workspace/email enforced transactionally                        |
| MFA                               | Library schema for factors/recovery codes; never returned by ordinary profile reads                                                                                                                     |
| API key                           | Library-owned secret verifier and lifecycle; separate personal/team configuration; expiration, prefix, last use, revocation                                                                             |
| API key policy                    | Key foreign key, workspace, scope, personal owner if any, creator attribution, read/edit access, include-admin flag, explicit granted actions, policy version; writable only through Towbar policy code |
| Transactional email outbox        | Workspace, template/version, recipient, dedupe key, encrypted sensitive template data, state, lease/attempt/next retry, safe error and delivery timestamps                                              |
| Audit/operation attribution       | Actor kind, optional human user, optional key, workspace, target, safe metadata, timestamp; no fabricated human identity for service keys                                                               |

Use relational constraints wherever the library permits. Reject client-supplied role, verification, forced-password-change, scope, creator, and permission fields outside their authorized forms. Case-normalize email consistently without provider-specific Gmail-style alias rewriting.

Invitations use the library's reviewed identifiers and acceptance mechanism plus mailbox verification. Do not add a parallel invite-token system by default, or describe the library's invitation ID as a hash-only secret when it is not. Any additional bearer token required by a proven integration gap must be random, purpose-bound, expiring, and stored as a verifier.

## Setup, identity, and member lifecycle

Bootstrap remains protected by a database lock and explicit installation setup state. Claim setup once, provision user/workspace/admin membership, and enable the session only after all required records exist. Prove rollback or resumable idempotent completion if library operations span transactions. Counting users alone must not permanently strand a partially completed setup.

Generate the setup code locally during installation, store its verifier, and show the operator the setup link once through the installation command. Require that code at the setup endpoint and consume it only after successful provisioning. This is an installation credential, not a user-configured provider secret or an invitation. Keep it out of request logging and telemetry; a local operator recovery command can issue a replacement if setup was interrupted.

Open signup stays closed after setup. Authorized registration runs only within a validated invitation flow; a public call directly to the library signup endpoint must not create an account. Enforce limits at Towbar wrappers as well: Better Auth's [rate-limit documentation](https://better-auth.com/docs/concepts/rate-limit) says server API calls do not inherit client endpoint rate limits.

Admin-managed Members page actions:

- Add user: name, email, temporary password, confirmation, and an Admin/Member/Viewer role selector defaulting to Member. Describe each role alongside the choice; Admin is an explicit choice. Duplicate existing users are not overwritten and their password cannot be reset by this form.
- Invite: email and the same Admin/Member/Viewer role selector, default Member; seven-day expiry; copy link and send email when SMTP is ready. Resend supersedes an earlier pending invitation and its pending mail.
- Change role: transactionally enforce at least one active admin and update affected personal-key policies. Re-read authorization inside the transaction to handle concurrent role changes.
- Remove access: revoke membership/sessions/personal keys, retain operational records and audit attribution. Rejoining must not resurrect old keys. Confirm removal separately.
- Pending invitations: recipient, role, expiration, delivery state, copy, resend, revoke. Invitations must remain valid only while their granting authority is valid; demotion/removal of an inviter revokes their outstanding invitations in this version.

Invite acceptance begins with a safe preview that performs no mutation, so email link scanners cannot consume it. An unverified new account completes mailbox verification and sets its own password. An existing account signs in, proves the invited email, and accepts without replacing its credentials. Acceptance/role checks/consumption are atomic and safe under replay and concurrent requests.

When SMTP is missing, new users can be directly provisioned with a temporary password. Invitation signup remains pending until mailbox verification is possible. Initial/direct provisioning is audited as administrator attestation and does not manufacture `emailVerified = true`.

Use 15-character minimum passwords, support long passphrases, permit password managers/paste, and block common compromised choices without composition rules or periodic forced rotation. The minimum and MFA recommendation follow [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Temporary-password replacement and compromise recovery are distinct from arbitrary periodic rotation.

Use library password verification/hashing and capacity limits; benchmark configured cost on the deployment runtime before removing existing password helpers. Preserve encryption helpers used for provider credentials. Password recovery uses expiring one-time links, generic responses, session revocation, and ordinary sign-in afterward, following [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). Keep an audited operator-only recovery path for an instance with failed SMTP; it must not expose a remote password-reset backdoor.

Add optional TOTP enrollment and one-time recovery codes using [Better Auth 2FA](https://better-auth.com/docs/plugins/2fa). Require recent password/MFA authentication for promotion, administrative keys, account recovery changes, and credential reveal. Reuse a short freshness window rather than interrupting every ordinary edit. Invited admins are not exempt from enabled MFA rules.

## API keys and automation

Represent ownership and authority separately:

- Scope: Personal or Team.
- Access: Read-only or Edit.
- Include administrative permissions: available only to admins and only with Edit access.

Viewers can create and revoke their own read-only personal keys. Their form fixes Access to Read-only and omits Team scope and administrative permissions; the API independently rejects attempts to request Edit, administrative grants, or team ownership. Members can choose Read-only or Edit for personal keys. Admins can create personal or team keys with the supported permission combinations.

These produce the earlier three presets without pretending that a key is a team member. Read-only excludes raw secret material even for an admin. Edit includes the permitted repository, secret-update, and Scout actions. Administrative permissions add supported privileged automation operations. Show the concrete permission summary before creation.

Personal key authority is the intersection of the stored action grants, its access ceiling, the owner's current active membership, and resource scope. On any demotion, intersect stored grants with the new role and increment policy version in the same transaction. Admin-to-Member removes administrative grants; Admin-to-Viewer or Member-to-Viewer also removes all write grants and sets access to Read-only. Revalidate queued effects and active clients against the new authority. Future promotion does not expand old keys or restore their former access setting. New product capabilities do not automatically appear on existing keys without explicit policy reissue.

Team key authority is its explicit workspace action grant and current key policy. Only admins create, change, or revoke it. It survives the creator's departure and records the creator as history. All admins can see its inventory and usage; no one can retrieve its original token later.

Use the API Key plugin for generation, verification, expiry, and storage. A protected policy record supplies Towbar-specific restrictions and key/workspace identity. A key with no valid policy record is unusable. Key creation plus policy persistence must be atomic or fail closed with compensation. Plugin permission defaults evaluated on creation must not be mistaken for live membership enforcement; [the permission reference](https://better-auth.com/docs/plugins/api-key/reference) describes both defaults and per-verification permission checks.

Keep [API-key session emulation](https://better-auth.com/docs/plugins/api-key/advanced) disabled. Tokens cannot sign in to the dashboard, change personal passwords/MFA, create more keys, or access browser-only credential reveal paths. Administrative keys can perform the admin operations explicitly exposed to automation; human account lifecycle remains browser-only in this version.

Preserve Bearer authentication and one-time token display. Proposed default expiry is 90 days, with explicit shorter/longer choices and admin-only no-expiry selection. This is a configurable product default, not an asserted industry requirement. Support overlapping key replacement and revoke, with last-used metadata and per-key as well as address-based rate limits.

MCP tool discovery and calls use the same permission evaluation as REST. Composite tools declare all required actions and re-check each dependent operation. Keep protocol annotations, OpenAPI documentation, and generated response contracts consistent. Client approval and MCP annotations never substitute for authorization.

## UI and routing

Primary sidebar groups remain Overview, Operate, Monitoring, Manage, and Workspace. Under Workspace show Team Settings to admins and Personal Settings to everyone. Add a compact current-user/team/role identity in the sidebar footer so the initial Admin role is visible. Preserve existing brand/version treatment.

Route layout:

- `/settings/profile` and `/settings/sessions`: existing personal pages, renamed parent.
- `/settings/security`: optional MFA and recovery-code controls, alongside existing password management without duplicating forms.
- `/team-settings`: redirects to Members.
- `/team-settings/members`: members and invitations, with Add user/Create invite actions at title level.
- `/team-settings/general`: name and Description form.
- `/invite/...`, verification, first-password-change, and password-reset routes: explicit public/restricted auth states in ApplicationFrame, without redirect loops.
- Keys & Token Store: Private Keys (admin), Personal API Keys (everyone), Team API Keys (admin), then existing API/MCP docs. Use real section URLs and consistent default selection. Members and viewers land on Personal API Keys and do not fetch the private-key collection. Viewer key creation shows read-only access explicitly.

Hide Integrations, Notifications configuration, Team Settings, and admin-only key sections for members and viewers. Keep the personal notification inbox separate from notification-provider management. Permit server overview and Scout monitoring while hiding Credentials, TLS, preparation, cleanup, and removal controls for both roles. Members retain Scout configuration and secret-management controls. Viewers see operational data without repository mutations, Scout/alert editing, secret-management pages, or other shared-resource actions. Read-only pages must use permitted queries rather than loading an administrative form and disabling its inputs. Hide empty sidebar groups. Restrict direct routes and queries as well as controls; avoid a flash of unauthorized content.

Refresh capability state on navigation/focus and after permission errors. Clear private query data on sign-out/account switch/downgrade. Already-open forms must respond to a permission loss without saving stale privileged changes.

Use the existing Widget, ResourceTable, Select, Modal, required-field labels, masked dot/eye controls, and compact tooltips. Description is optional but labeled Description. Preserve modal content through closing transitions. Use role/status chips and accessible validation.

## API/service map

Retain Towbar wrappers for domain-specific policies; use Better Auth handlers for supported session/recovery/MFA mechanics through an allowlisted mount.

| Route family                             | Responsibilities                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/v1/public/auth/setup-status`, `/setup` | Singleton bootstrap admission                                                               |
| Auth mount                               | Sign-in/out, session, verification, recovery, allowed MFA and restricted registration flows |
| `/v1/core/team`                          | General read/update; admin policy                                                           |
| `/v1/core/team/members`                  | Paginated listing, direct creation, role updates, removal                                   |
| `/v1/core/team/invitations`              | List, create, resend, revoke; library-backed lifecycle                                      |
| Public invitation facade                 | Safe preview and gated acceptance; scoped email proof                                       |
| `/v1/core/settings/api-keys/personal`    | Current user's key listing/create/revoke                                                    |
| `/v1/core/settings/api-keys/team`        | Admin team-key listing/create/revoke                                                        |
| `/v1/core/session`                       | User, workspace, role, capabilities, restricted-auth state                                  |
| `/v1/api`, `/v1/mcp`                     | Shared actor/capability enforcement                                                         |

Team key creation and role changes are idempotent where retries can otherwise duplicate results. Audit writes and email outbox insertion belong in the same transaction as the successful domain change.

## Email rendering and delivery

Add `@workspace/towbar-email` with a restrained layout: Towbar identity, meaningful heading, brief context, one primary action where needed, fallback link, and a small footer identifying the team/instance. Render HTML plus plain text using [React Email rendering utilities](https://react.email/docs/utilities/render). React Email is the template library; delivery stays SMTP and does not require a Resend account/provider.

Initial templates: invitation; email verification; direct-account notice without password; invitation accepted; role changed; access removed; password reset; password changed; MFA/recovery changes; administrative team-key created/revoked. Invitation and role-change templates use the Admin/Member/Viewer labels and describe the granted access; downgrade notices explain any resulting personal-key access reduction. Send account-specific mail to the affected person and administrative security events to current admins as appropriate. Keep ordinary deployment/incident recipients governed by their existing categories.

Reuse the encrypted workspace SMTP configuration and fixed Towbar subject prefix. Share the transport and email shell with operational notification emails. Team/security mail is not controlled by deployment-notification category fields.

Use a dedicated transactional-email outbox because existing notification events require a repository or server. Persist the domain event and delivery request atomically. Pass only an outbox ID through Temporal; resolve credentials and render inside the activity. Store invitation/verification/reset links needed for retries in encrypted, short-lived payload fields, not plaintext JSON, logs, audit metadata, or workflow history. Purge sensitive data after delivery/expiry and suppress superseded/revoked invitations before sending.

Use deterministic dedupe keys, database claims/leases, bounded retry/backoff, and the existing maintenance recovery pattern for a crash before workflow start. SMTP acceptance is not inbox delivery; label it Sent/Accepted accurately. Retries can still duplicate mail after an ambiguous SMTP timeout, so do not claim exactly-once delivery.

Recipients and templates are server-derived. Links use the configured canonical app URL, never the request Host header. Token pages use no-store and a restrictive referrer policy. HTML content is escaped and does not execute supplied Markdown/HTML. SMTP failures are visible to admins without exposing credentials. Add SMTP setup/test guidance, including the sender domain's SPF/DKIM/DMARC setup, to self-hosting docs.

## Implementation sequence and proof

1. Record the pinned library integration proof and permission/effect inventory. Confirm adapter/transaction behavior before broad edits.
2. Define the canonical auth/workspace/key policy schema, actor contract, shared access package, and new-instance fixtures.
3. Implement setup and auth replacement, restricted first-login flow, recovery, and optional MFA. Update operator recovery, cookies/CORS/origin protections, and client session hooks together.
4. Add team lifecycle, invitation verification, atomic last-admin and demotion logic, audit events, and direct-member creation.
5. Refactor all protected routes/services and queued-operation admission. Correct repository effects, secret reveal/update separation, and Scout's narrow exception.
6. Implement personal/team API-key wrappers, live policy enforcement, service actor attribution, REST/MCP discovery/dispatch, and generated docs.
7. Build Team/Personal Settings, role-aware navigation, permitted read-only views, and both key inventories.
8. Add email templates/outbox/Temporal delivery and migrate operational email rendering to the shared shell.
9. Finish fixtures and integration/browser verification; consolidate schema history to `001` before merge and prove a complete fresh installation from it.

Required tests and acceptance cases:

- Setup-code validation, concurrent bootstrap, interrupted bootstrap recovery, blocked open signup, and exactly one first admin/team.
- Admin/member/viewer/public/worker/Scout/webhook principals for every route class; permission metadata cannot be omitted accidentally.
- Wrong workspace and wrong parent IDs; member/viewer direct-route/API access to private/team keys, integrations, team management, and credential reveal denied. Own personal-key management remains allowed within each role's ceiling.
- Two admins concurrently demoting/removing each other cannot leave zero active admins.
- Admin APIs can assign only admin/member/viewer; client-supplied protected fields and raw library endpoints cannot escalate privileges.
- Invite expiry/revoke/reissue, copied link without mailbox proof, mismatched account, existing account, link-scanner GET, replay, simultaneous acceptance, inviter demotion, and email outage.
- Temporary-password restrictions through all auth and API paths; MFA and password recovery including session revocation.
- Member repository sync cannot deploy; branch changes cannot repoint active automation; reconciliation cannot invoke privileged server/cleanup effects.
- Member can update/reference secrets without exposing existing values; unchanged masks and inherited references round-trip safely.
- Viewer can read permitted operational data and manage their own account, sessions, inbox, and read-only personal keys. Repository mutations, secret updates/references, Scout lifecycle/configuration, alert-rule mutations, and all other shared-resource writes are denied through sessions, REST, and MCP.
- Scout permission executes only its intended lifecycle operations and never returns SSH/provider credentials.
- Personal key role downgrade/removal takes effect on the next request; cover Admin-to-Member, Admin-to-Viewer, and Member-to-Viewer, including previously issued Edit/admin keys and queued effects. Promotion does not silently expand existing grants or restore Edit access; removed-and-readded users cannot reuse revoked keys.
- Viewer key creation cannot forge Edit/admin permissions, Team scope, another owner, or broader action grants. Read-only tools remain discoverable and callable; mutating tools are absent and direct calls denied.
- Team key remains a team actor after creator removal; missing policies fail closed; key scope/policy cannot be modified through raw plugin endpoints.
- Read-only keys cannot reveal secrets; administrative keys cannot use browser-only account/key-creation/credential-reveal endpoints.
- MCP listing and composite calls respect the same restrictions, including membership/key changes between requests and streams.
- Outbox transaction rollback, crash before scheduling, retry lease recovery, expired invite suppression, safe errors, encryption/redaction, and truthful send status.
- Local fixture profiles for new instance, admin, member, viewer, pending invitations for all three roles, restricted first login, SMTP unavailable, and multiple key scopes. Real database/API tests establish security; fixtures establish UI behavior.
- Browser exercise of onboarding, invite verification, existing-account acceptance, all three roles' navigation, both settings menus, key creation/revoke, role changes including an already-open editor downgraded to Viewer, direct URLs, back/forward, focus, masked fields, and modal closing.
- Render each HTML/plain-text template and inspect desktop/mobile previews with an isolated local SMTP capture service. Send no real email during verification.
- Run focused package checks, generated API/MCP checks, then `pnpm verify`, database-backed security tests, Temporal delivery tests, and fresh-baseline installation checks. State any skipped infrastructure test explicitly.

Implementation is complete when the final fresh schema, all actor types, Admin/Member/Viewer UI, invitation lifecycle, key authority changes, and durable mail delivery agree with this policy. A fixture screen or a successful queued email alone is not that proof.
