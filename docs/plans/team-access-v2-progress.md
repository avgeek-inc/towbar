# Team access v2 implementation and verification

Implemented and verified locally on 16 September 2026 in the existing checkout. Existing unrelated changes are preserved. No push, deployment, real email delivery or production database change was performed.

## Delivered

- Better Auth, Drizzle adapter and API Key plugin pinned to 1.7.5. Workspace/member/invitation storage is canonical; there is no parallel membership model or legacy password-session implementation.
- Shared Admin/Member/Viewer permissions, explicit REST/MCP policy, denial for undeclared routes, live membership/key intersections, browser-only sensitive actions and recent authentication.
- Installer setup codes, closed signup, temporary-password replacement, invitation mailbox verification, password reset, optional TOTP/recovery codes and local operator recovery.
- Atomic team/member/invitation lifecycle, last-admin protection, irreversible narrowing of existing personal-key grants on demotion, invitation invalidation and session/key revocation on removal.
- Personal/team API keys, one-time token display, idempotent creation and team service identities independent of their creator. Per-address and per-key rate limits return retryable responses.
- Queued actor snapshots and effect-time checks for deployment, repository sync, server, resource, preview and Scout work. Member sync cannot deploy or revive removed servers and pauses runtime automation. Branch changes cannot silently repoint enabled automation.
- Team Settings, Personal Settings, role-aware navigation/query/action guards, cache clearing on identity/permission changes and public/restricted auth forms. Fixtures cover all three roles, new installation, temporary passwords, invitations, SMTP outage and key scopes.
- React Email HTML/plain-text templates, shared SMTP transport, encrypted transactional outbox with claims, bounded retry, expiry and suppression. Temporal receives outbox IDs only.
- Fresh `001_team_access_v2` SQL, snapshot and journal, including runtime ownership and monitoring safeguards. The runner rejects a 1.x schema without altering its records. Original migration files were backed up outside the checkout at `/tmp/towbar-pre-v2-migrations` before consolidation.
- Self-hosting guidance for setup, recovery, permissions, keys, MFA, SMTP and the fresh-v2-only boundary; API/MCP contracts and documentation refreshed.

## Integration decisions proven during implementation

Better Auth owns password/session/MFA/token mechanics. Towbar transaction services use the same mapped organization tables to enforce workspace locking, last-admin rules, invitation consumption and key-policy updates atomically. Raw organization, registration and API-key plugin endpoints are blocked from bypassing those wrappers. API-key session emulation is disabled.

Concurrent PostgreSQL tests exposed a rate-counter race in the adapter's guarded subquery. Towbar now locks the matching key row during plugin verification. A four-request burst against a two-request allowance admits exactly two requests, rejects the others with 429 and `Retry-After`, preserves independence between keys and resumes after the window expires. The wrapper retains the library's hashing, verification and expiration behavior.

Password verification uses the library's hashing with a bounded process queue. Compromised-password checks send only a five-character SHA-1 prefix, request padded responses, enforce a five-second deadline and fail closed on malformed/unavailable responses. Provider/SSH credential encryption remains separate.

The actual API deployment image (Node 24.21.0, Linux ARM64 on the local Docker host) completed five sequential password hash-and-verify runs in 170, 166, 146, 161 and 157 ms. Peak RSS for the smoke process including loaded API modules was about 322 MiB. These measurements validate this image locally, not production-host capacity.

## Verification results

| Gate                                                                           | Result                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                                                  | Passed: docs/generated artifact checks, formatting, lint, workspace typecheck, unit/fixture suites and production builds                                                            |
| PostgreSQL-backed API regression                                               | 244 passed, 0 failed; one separately gated team suite skipped here and executed below                                                                                               |
| Dedicated fresh-database team/security suite plus password corpus client tests | 21 passed, 0 failed, 0 skipped                                                                                                                                                      |
| Fresh baseline, repeat migration, 1.x rejection and runtime triggers           | 2 passed, 0 skipped; schema generation reported no drift                                                                                                                            |
| Shared permission policy                                                       | 4 passed                                                                                                                                                                            |
| Web unit tests / fixture server tests                                          | 44 / 33 passed                                                                                                                                                                      |
| Email rendering                                                                | 13 passed                                                                                                                                                                           |
| Real local SMTP capture                                                        | All 12 transactional templates and operational email sent as HTML/plain text through authenticated, certificate-verified TLS; wrong credentials and untrusted certificates rejected |
| Local Temporal integration                                                     | Worker restart, activity retry and persisted-history replay passed; workflow/activity inputs contained only outbox IDs                                                              |
| API Docker build and runtime smoke                                             | Image built; fresh baseline, setup, secure cookie, authenticated team route and React Email rendering passed inside it                                                              |
| `pnpm audit --prod`                                                            | 0 known advisories at verification time                                                                                                                                             |
| `git diff --check`                                                             | Passed                                                                                                                                                                              |

The database tests include concurrent setup, blocked raw auth endpoints, temporary-password restrictions, mailbox proof, invite expiry/reissue/replay/concurrent acceptance, mismatched existing accounts, inviter demotion, concurrent last-admin protection, personal-key narrowing and revocation, team-key creator departure, idempotent key retries, queued authority loss, operator recovery, MFA/recovery/password reset, and encrypted-outbox rollback/claims/retry/purge.

A separate Member-effects integration test executes repository sync against PostgreSQL: inventory succeeds, automation pauses, no deployment is created, server preparation remains unchanged, forged deployment authority is rejected, and demotion to Viewer blocks pending sync work. It is included in the API regression count above.

## Browser verification

Desktop and mobile review covered:

- Admin, Member and Viewer navigation and direct-route denial; no private-key query on Member/Viewer key landing pages.
- Team General and Members, required fields, role descriptions, responsive modal/select layout, role changes, Cancel/focus restoration and back/forward navigation.
- An Admin form left open during a downgrade: the rejected action refreshes permissions, removes the form and clears privileged content.
- Viewer read-only key creation, one-time display and revoke; Member Scout controls and masked Form/File secrets; Viewer Scout read-only state.
- Setup form and required validation; temporary-password redirects; invitation preview, wrong account, invalid code, verification continuation, existing-account acceptance and unavailable SMTP.
- MFA challenge, recovery-code alternative and successful continuation.
- Every transactional template at desktop and mobile widths, with corresponding HTML/plain-text renderer and SMTP checks.

The review fixed public-auth failures that were previously sent to an unmounted toast area; invitations now show actionable inline errors. It also fixed role-selector width, modal cancellation, stale access-denial presentation and long server instance labels overlapping adjacent values.

## Reproducing the infrastructure gates

Use disposable databases ending in `_test`. The team security suite requires a fresh migrated database; the API regression suite creates and cleans its own workspace records.

```bash
TOWBAR_TEST_DATABASE_URL=postgres://.../towbar_team_regression_test pnpm --filter towbar-api test
TOWBAR_TEAM_TEST_DATABASE_URL=postgres://.../towbar_team_security_test pnpm --filter towbar-api exec tsx --test src/areas/team/security.integration.test.ts src/areas/auth/password-breach-check.test.ts
TOWBAR_TEST_DATABASE_URL=postgres://.../towbar_team_regression_test pnpm --filter @workspace/towbar-database test
TOWBAR_TEST_TEMPORAL_ADDRESS=127.0.0.1:47233 pnpm --filter towbar-worker exec tsx --test src/workflows/transactional-email.integration.test.ts
pnpm --filter towbar-api exec tsx --test src/areas/notifications/smtp.integration.test.ts
pnpm verify
pnpm audit --prod
docker build -f apps/towbar-api/Dockerfile -t towbar-team-access-test:local .
```

Local evidence logs are under `/tmp/towbar-team-*`. Disposable verification used PostgreSQL container `towbar-team-access-tests` on `127.0.0.1:32801`, a local Temporal development server on `127.0.0.1:47233`, ephemeral loopback SMTP, and fixture API/web ports 4420/4021. The fixture is returned to Admin for review.

No known failing checks remain. These results establish local behavior; they do not claim production deployment, delivery to real inboxes, exhaustive security certification or absence of every possible defect.

## Settings UX and authentication follow-up

Implemented the September 16 settings review: sidebar identity separation; General before Members; member name and role editing; compact forms with subordinate role descriptions; standalone invitation table; stable copy-link controls; resend/revoke confirmations; one temporary-password field; half-width Team details; separate profile/name/email widgets; Personal and Team API key navigation; standalone Private Keys Store.

Added confirmed email changes using hashed, expiring, single-use proofs and encrypted transactional email. New requests invalidate prior links; confirmation revokes browser sessions and notifies the old address. Added a 2FA page with direct authenticator enrollment, bounded code attempts, recovery-code replacement, and Better Auth passkeys. WebAuthn origin/RP are server-configured, device verification is mandatory, and the database enforces unique credential IDs. Freshness is enforced by the Towbar facade using `authenticatedAt` so reauthentication works for an older browser session. The fresh-install `001` baseline includes passkeys and pending email changes.

Design references reviewed through Mobbin: [Gemini authentication methods](https://mobbin.com/screens/892d2e28-084d-4deb-9080-6602282e55b1), [Mercury security settings](https://mobbin.com/screens/61170c15-0349-45ef-a6b0-b6ec95b7d1f6), and [Juicebox pending invitations](https://mobbin.com/screens/5bfa6e44-54a0-4551-b848-4d2d50f26da0). The implementation retains Towbar's existing widgets, table, form, and modal components.

Verification completed for this follow-up:

- `pnpm verify`: documentation, formatting, lint, type checks, unit/fixture tests, and production builds pass. Environment-gated infrastructure tests are also run separately below.
- Dedicated PostgreSQL settings suite: 5 tests pass, covering member edits, temporary-password restrictions, stale-session rejection and reauthentication, authenticator enrollment/attempt limits, signed WebAuthn registration/authentication, origin/device-verification/ownership checks, malformed requests, one-use challenges, and email expiry/supersession/cancellation/concurrent confirmation/session revocation.
- Existing PostgreSQL team security and password-breach suite: 21 tests pass.
- PostgreSQL API regression: 244 pass, 2 skipped (the separately executed team/settings suites).
- Fresh database baseline and safeguards: 2 tests pass.
- SMTP capture sends HTML and plain text for all 14 transactional templates over verified TLS; 15 email rendering tests pass.
- API contract generation check: 182 browser/core handlers, 134 public REST operations, and 54 MCP tools. The new account-security operations are browser-only.
- Production dependency audit: zero known advisories after upgrading SimpleWebAuthn to 13.3.2 for [GHSA-6hxq-p678-4hr2](https://github.com/advisories/GHSA-6hxq-p678-4hr2).
- Browser review: sidebar divider, half-width General form, reordered navigation, compact Add/Edit/Invitation forms, subordinate role descriptions, stable Copy Link, Resend/Revoke confirmations, separate profile/email widgets, direct authenticator QR setup, passkey setup dialog, email-confirmation fragment cleanup, and the three relocated key-management pages. A 390px viewport check found no document overflow; temporary viewport overrides were reset.

Evidence logs are `/tmp/towbar-settings-*.log`, with the audit in `/tmp/towbar-settings-audit.json`. The fixture and web app remain available on ports 4420 and 4021, with the Admin fixture restored.

Actual device biometric/passkey prompts remain a manual hardware-browser check: the in-app browser does not expose virtual-authenticator commands. Cryptographic protocol tests use signed WebAuthn responses against the real Better Auth endpoints. Email transport is verified against a local SMTP capture, not a real inbox. No production deployment was performed.
