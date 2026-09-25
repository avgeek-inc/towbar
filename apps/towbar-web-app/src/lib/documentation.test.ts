import assert from "node:assert/strict";
import test from "node:test";
import { documentationTopic, headingDocumentation } from "./documentation";

void test("detail routes keep help scoped to the feature being viewed", () => {
  const cases = [
    ["/", "overview"],
    ["/repositories/repo/settings/danger", "repositoryRemoval"],
    ["/repositories/repo/syncs/sync/issues", "sync"],
    ["/apps/app/deployments/deploy/progress", "progress"],
    [
      "/resources/resource/deployments/deploy/vulnerabilities",
      "vulnerabilities",
    ],
    ["/apps/app/compare-deployments", "comparison"],
    ["/servers/server/settings/danger", "removal"],
    ["/servers/server/settings/monitoring", "scout"],
    ["/servers/server/preparation", "preparation"],
    ["/manage/integrations/telegram", "telegram"],
    ["/manage/integrations/gitlab", "gitlab"],
    ["/manage/integrations/registry", "registry"],
    ["/manage/integrations/infisical", "externalSecrets"],
    ["/manage/integrations/cloudflare", "cloudflare"],
    ["/settings/email-password", "emailPassword"],
    ["/settings/2fa", "security"],
    ["/team-settings/api-keys", "apiKeys"],
    ["/team-settings/audit-logs", "auditLogs"],
    ["/manage/integrations/deliveries", "deliveries"],
    ["/team-settings/ssh-keys", "keys"],
    ["/manage/ssh-keys", "keys"],
    ["/manage/shared-secrets", "secrets"],
    ["/monitoring/incidents", "incidents"],
  ] as const;
  for (const [path, expected] of cases)
    assert.equal(documentationTopic(path), expected, path);
});

void test("reused widget titles resolve to the correct feature documentation", () => {
  const cases = [
    [
      "/manage/integrations/github",
      "Connection details",
      "/integrations/github",
    ],
    [
      "/resources/db/connection",
      "Connection details",
      "/resources#connect-privately",
    ],
    ["/apps/app/compare-deployments", "CPU usage", "/deployment-comparisons"],
    [
      "/servers/server/performance",
      "CPU usage",
      "/monitoring#performance-history",
    ],
    ["/resources/db", "Current state", "/resources"],
    ["/apps/app", "Current state", "/apps"],
    [
      "/manage/integrations/email",
      "Configuration",
      "/integrations/notifications#configure-email",
    ],
    [
      "/manage/integrations/slack",
      "Credentials",
      "/integrations/notifications#configure-slack",
    ],
    [
      "/repositories/repo/settings/danger",
      "Danger zone",
      "/repositories#delete-a-repository",
    ],
  ];
  for (const [path, title, expected] of cases) {
    const help = headingDocumentation(path!, title!, "widget");
    assert.ok(help, `${path}: ${title}`);
    assert.ok(help.href.endsWith(expected!), `${path}: ${title}`);
    assert.ok(help.description.length > 20);
  }
  assert.equal(
    headingDocumentation("/unknown", "Credentials", "widget"),
    undefined,
  );
  assert.equal(
    headingDocumentation("/apps/app", "Unknown widget", "widget"),
    undefined,
  );
});
