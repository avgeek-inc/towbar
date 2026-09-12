import { deploymentEnvironmentSnapshot } from "../apps/instance-environment.js";
import { and, eq } from "drizzle-orm";
import {
  apps,
  sourceEntities,
  sourceEnvironments,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function testInstanceLinks(
  sourceId: string,
  manifestId: string,
  entityType: "app" | "resource" = "app",
) {
  const db = getTowbarDatabase();
  await db
    .insert(sourceEnvironments)
    .values({ sourceId, name: "production", branch: "main" })
    .onConflictDoNothing();
  await db
    .insert(sourceEntities)
    .values({ sourceId, manifestId, entityType })
    .onConflictDoNothing();
  const [environment] = await db
    .select()
    .from(sourceEnvironments)
    .where(
      and(
        eq(sourceEnvironments.sourceId, sourceId),
        eq(sourceEnvironments.name, "production"),
      ),
    );
  const [entity] = await db
    .select()
    .from(sourceEntities)
    .where(
      and(
        eq(sourceEntities.sourceId, sourceId),
        eq(sourceEntities.manifestId, manifestId),
        eq(sourceEntities.entityType, entityType),
      ),
    );
  if (!environment || !entity) throw new Error("Unable to seed instance links");
  return {
    sourceEnvironmentId: environment.id,
    entityId: entity.id,
    requiredSecrets: { build: [], runtime: [], preDeploy: [], postDeploy: [] },
  };
}

export async function testDeploymentEnvironment(appId: string) {
  const db = getTowbarDatabase();
  const [row] = await db
    .select({ environment: sourceEnvironments })
    .from(apps)
    .innerJoin(
      sourceEnvironments,
      eq(sourceEnvironments.id, apps.sourceEnvironmentId),
    )
    .where(eq(apps.id, appId));
  if (!row) throw new Error("Missing test deployment environment");
  return deploymentEnvironmentSnapshot(row.environment);
}
