import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderIcon,
  integrationGroups,
  notificationProviders,
} from "../components/integrations";
import { integrationRoutes, isIntegrationRoute } from "./integration-routes";

test("every integration navigation target has a distinct accepted route", () => {
  const navigationTargets = [
    ...integrationGroups.flatMap((group) =>
      group.providers.map((provider) => provider.value),
    ),
    ...notificationProviders.map((provider) => provider.value),
    "deliveries",
  ];

  assert.equal(
    new Set(navigationTargets).size,
    navigationTargets.length,
    "integration navigation routes must be unique",
  );
  assert.deepEqual(
    new Set(integrationRoutes),
    new Set(navigationTargets),
    "the server route allowlist must match the integration navigation",
  );
  assert(navigationTargets.every((target) => isIntegrationRoute(target)));
  assert(
    navigationTargets.every((target) => getProviderIcon(target) !== null),
    "every integration provider must have a configured logo",
  );
  assert.equal(isIntegrationRoute("unknown-provider"), false);
});
