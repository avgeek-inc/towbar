import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderIcon,
  integrationGroups,
  logForwardingProviders,
  notificationProviders,
} from "../components/integrations";
import {
  integrationRoutes,
  isIntegrationRoute,
  isLogForwardingRoute,
  logForwardingRoutes,
} from "./integration-routes";

test("every integration navigation target has a distinct accepted route", () => {
  const navigationTargets = [
    ...integrationGroups.flatMap((group) =>
      group.providers.map((provider) => provider.value),
    ),
    ...logForwardingProviders.map((provider) => provider.value),
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
  for (const provider of [
    "signoz",
    "splunk",
    "honeycomb",
    "mezmo",
    "fluentBit",
    "awsSecretsManager",
  ])
    assert.equal(isIntegrationRoute(provider), false);
  assert.equal(isIntegrationRoute("unknown-provider"), false);
});

test("log forwarding providers are part of the integration route set", () => {
  const navigationTargets = logForwardingProviders.map(
    (provider) => provider.value,
  );

  assert.deepEqual(new Set(logForwardingRoutes), new Set(navigationTargets));
  assert(navigationTargets.every((target) => isLogForwardingRoute(target)));
  assert(
    navigationTargets.every((target) => isIntegrationRoute(target)),
    "log forwarding routes must be available inside integrations",
  );
  assert(
    navigationTargets.every((target) => getProviderIcon(target) !== null),
    "every log forwarding provider must have a configured logo",
  );
  assert.equal(isLogForwardingRoute("unknown-provider"), false);
});
