// New fixture endpoints are private until explicitly reviewed for public use.
const id = "[a-f0-9-]{36}";
const readRoutes = [
  /^\/v1\/public\/auth\/(state|setup-status)$/,
  /^\/v1\/core\/(session|profile|sessions|version|system-health|integrations)$/,
  /^\/v1\/core\/profile\/(preferences|passkeys)$/,
  /^\/v1\/core\/team(?:\/(members|invitations|audit-logs(?:\/filters)?))?$/,
  /^\/v1\/core\/settings\/(secrets|private-keys)$/,
  /^\/v1\/core\/github(?:\/(installation|repositories|branches))?$/,
  /^\/v1\/core\/gitlab\/(connections|repositories|groups|branches)$/,
  /^\/v1\/core\/notifications(?:\/(providers|destinations|deliveries|(?:slack|discord|telegram|webhook|email)\/destinations))?$/,
  /^\/v1\/core\/monitoring\/(summary|incidents|vulnerabilities)$/,
  new RegExp(
    `^/v1/core/(apps|resources|servers|sources|deployments)(?:/${id})?$`,
  ),
  /^\/v1\/core\/deployments\/history$/,
  new RegExp(
    `^/v1/core/deployments/${id}/(steps|logs|events|source-revision|vulnerability-scan/findings)$`,
  ),
  new RegExp(
    `^/v1/core/(apps|resources)/${id}/(auto-deploy-control|secrets(?:/readiness)?|deployments|releases|operations|previews|storage|jobs|backup-assurance)$`,
  ),
  new RegExp(`^/v1/core/(apps|resources)/${id}/operations/${id}/events$`),
  new RegExp(
    `^/v1/core/servers/${id}/(apps|resources|deployments|capacity|checks|preparations|host-keys|orphans|credentials|monitoring(?:/(history|agent))?)$`,
  ),
  new RegExp(
    `^/v1/core/sources/${id}/(apps|resources|capacity|deployments|previews|backups|syncs(?:/${id})?|auto-deploy-control|environments(?:/${id}/manifest)?|notifications/destinations)$`,
  ),
  new RegExp(
    `^/v1/core/servers/${id}/scout-alerts(?:/(rules|incidents|settings|rules/${id}|incidents/${id}))?$`,
  ),
  new RegExp(
    `^/v1/core/workloads/${id}/(comparison-deployments|deployment-comparison)$`,
  ),
];
const writes = [
  ["PATCH", new RegExp(`^/v1/core/servers/${id}/name$`)],
  ["PUT", /^\/v1\/core\/profile\/preferences$/],
  [
    "PATCH",
    new RegExp(`^/v1/core/(apps|resources|sources)/${id}/auto-deploy-control$`),
  ],
  ["POST", /^\/v1\/core\/date-time\/localize$/],
  ["POST", /^\/v1\/core\/profile\/preferences\/(preview|range(?:\/resolve)?)$/],
  [
    "POST",
    new RegExp(
      `^/v1/core/(apps|resources)/${id}/actions/(deploy|start|stop|restart|logs|backup)$`,
    ),
  ],
  ["POST", new RegExp(`^/v1/core/servers/${id}/actions/check$`)],
  ["POST", new RegExp(`^/v1/core/sources/${id}/actions/sync$`)],
  ["POST", /^\/v1\/core\/system-health\/actions\/check$/],
];

export function allowsFixtureRequest(method, path) {
  return method === "GET"
    ? readRoutes.some((route) => route.test(path))
    : writes.some(([verb, route]) => verb === method && route.test(path));
}
