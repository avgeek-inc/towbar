# Event history

`GET /v1/core/team/audit-logs` and `/audit-logs/filters` require an Admin browser session. `GET /v1/core/notifications/deliveries` requires notification management and a browser session. Both listing services scope queries to the current workspace. Repository-scoped notification routes additionally constrain the repository. History is never part of the public API or MCP catalog.

## Adding an audit event

1. Register a stable dot-notation slug and a human-readable label and an icon identifier from `AuditEventIcon` in `packages/towbar-core/src/audit.ts`. Keep existing slugs stable, even when UI terms change. Register only non-secret metadata fields in that event's allowlist.
2. Call `recordAuditEvent(transaction, { workspaceId, action, targetType, targetId, ...auditAttribution(), metadata })` from the service that performs the action. Use the same transaction for both writes wherever the action is transactional. A rejected action must not produce a success audit event.
3. Record the affected entity's ID in `targetId`, rather than burying it in text. For multi-entity actions, include additional IDs in allowlisted metadata. Never record passwords, credential values, raw request bodies, or provider response bodies.
4. Add behavior-level coverage for the action and its audit attribution. The writer's `AuditEventSlug` type requires a catalog entry. The shared writer rejects unknown events at runtime and discards metadata not explicitly allowlisted.

The HTTP middleware attaches a request ID through AsyncLocalStorage, and the writer preserves session, personal-key, team-key, or system attribution. Background work has no HTTP request ID unless the caller explicitly carries it forward. The existing team `audit()` helper delegates to the same writer.

## Reading history

Both tables use bounded keyset pagination ordered by `(created_at DESC, id DESC)`. The cursor serializes PostgreSQL microseconds without converting through a JavaScript Date, so closely timed events are not skipped. Search is parameterized and treats `%`, `_`, and backslashes literally. Catalog labels are searched alongside stored slugs. Workspace/action/user cursor indexes support audit browsing, and notification indexes support workspace joins and delivery ordering.

Audit metadata is allowlisted again on read, including historical records. Unknown historical event slugs are displayed as-is with empty metadata. Notification results explicitly select display fields and omit encrypted destination configuration, full webhook URLs, raw event payloads, and raw provider error messages. A successful delivery means provider acceptance, not recipient receipt.

These pages expose existing captured events; they do not imply every application action has an audit record. Transactional account/team emails have a separate outbox. Retention, external export, tamper-evident storage, and additional action coverage can build on this catalog and writer without changing the UI contract.

Run `TOWBAR_HISTORY_TEST_DATABASE_URL=... pnpm --filter towbar-api exec tsx --test src/areas/event-history/history.integration.test.ts` against a fresh disposable database ending in `_test`. The integration suite verifies permissions, tenant isolation, cursor boundaries, literal search, metadata redaction, and atomic recording.
