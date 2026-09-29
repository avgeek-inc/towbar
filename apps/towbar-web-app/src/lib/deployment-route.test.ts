import assert from "node:assert/strict";
import test from "node:test";

import { deploymentDetailTarget, deploymentHref } from "./deployment-route";

void test("Compose deployment detail loads its Service and accepts its Service route", () => {
  const deployment = {
    id: "deployment",
    appId: "service",
    deployableKind: "compose" as const,
  };
  assert.equal(
    deploymentHref(deployment, "progress"),
    "/services/service/deployments/deployment/progress",
  );
  assert.deepEqual(deploymentDetailTarget(deployment, { appId: "service" }), {
    kind: "app",
    queryPath: "/v1/core/apps/service",
    belongsToRoute: true,
  });
  assert.equal(
    deploymentDetailTarget(deployment, { appId: "other" }).belongsToRoute,
    false,
  );
  assert.equal(
    deploymentDetailTarget(deployment, { resourceId: "service" })
      .belongsToRoute,
    false,
  );
});

void test("App and Datastore deployment detail keep their own lookup and route boundaries", () => {
  assert.deepEqual(
    deploymentDetailTarget(
      { appId: "app", deployableKind: "app" },
      { appId: "app" },
    ),
    {
      kind: "app",
      queryPath: "/v1/core/apps/app",
      belongsToRoute: true,
    },
  );
  const datastore = { appId: "database", deployableKind: "postgres" as const };
  assert.deepEqual(
    deploymentDetailTarget(datastore, { resourceId: "database" }),
    {
      kind: "resource",
      queryPath: "/v1/core/resources/database",
      belongsToRoute: true,
    },
  );
  assert.equal(
    deploymentDetailTarget(datastore, { appId: "database" }).belongsToRoute,
    false,
  );
});
