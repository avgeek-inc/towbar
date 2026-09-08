import assert from "node:assert/strict";

// An explicit boundary prevents accidental API/MCP exposure when routes are added.
export const expectedBrowserOnlyRoutes = new Set([
  "DELETE /servers/:serverId/notifications/destinations/:destinationId",
  "DELETE /sessions/:sessionId",
  "DELETE /settings/api-keys/:keyId",
  "DELETE /sources/:sourceId/notifications/destinations/:destinationId",
  "GET /monitoring/summary",
  "GET /notifications",
  "GET /notifications/providers",
  "GET /servers/:serverId/notifications/destinations",
  "GET /servers/:serverId/scout-alerts/incidents/:incidentId/notifications",
  "GET /sessions",
  "GET /settings/api-keys",
  "GET /sources/:sourceId/notifications/destinations",
  "PATCH /profile",
  "POST /github/actions/complete-installation",
  "POST /github/actions/installation-url",
  "POST /servers/:serverId/notifications/destinations",
  "POST /servers/:serverId/notifications/destinations/:destinationId/actions/test",
  "POST /settings/api-keys",
  "POST /sources/:sourceId/notifications/destinations",
  "POST /sources/:sourceId/notifications/destinations/:destinationId/actions/test",
  "PUT /profile/password",
  "PUT /servers/:serverId/notifications/destinations/:destinationId",
  "PUT /sources/:sourceId/notifications/destinations/:destinationId",
]);

export function assertPublicOperationNames(
  operations: Array<{ name: string }>,
) {
  assert.equal(
    new Set(operations.map((op) => op.name)).size,
    operations.length,
  );
  assert.equal(operations.length, 124);
  assert(operations.every((op) => op.name.length <= 64));
}
