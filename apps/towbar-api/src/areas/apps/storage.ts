import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { deployments, serverChecks } from "@workspace/towbar-database/schema";
import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getApp } from "./queries.js";

type Database = Pick<ReturnType<typeof getTowbarDatabase>, "select">;

export async function assertAppStorageServer(
  database: Database,
  appId: string,
  serverId: string,
) {
  const [bound] = await database
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.appId, appId),
        ne(deployments.serverId, serverId),
        sql`jsonb_array_length(coalesce(${deployments.appSnapshot}->'container'->'volumes', '[]'::jsonb)) > 0`,
      ),
    )
    .limit(1);
  if (bound)
    throw conflict(
      "This app has persistent storage on another server. Keep it on that server until its data has been explicitly migrated.",
      "APP_STORAGE_SERVER_MISMATCH",
    );
}

const observedVolumeSchema = z.object({
  deployableId: z.string(),
  runtimeId: z.string(),
  name: z.string(),
  volumeName: z.string(),
  mountPath: z.string(),
  mounted: z.boolean(),
});

export async function getAppStorage(appId: string, workspaceId: string) {
  const app = await getApp(appId, workspaceId);
  const [check] = await getTowbarDatabase()
    .select({
      result: serverChecks.result,
      finishedAt: serverChecks.finishedAt,
    })
    .from(serverChecks)
    .where(
      and(
        eq(serverChecks.serverId, app.serverId),
        eq(serverChecks.status, "succeeded"),
      ),
    )
    .orderBy(desc(serverChecks.createdAt))
    .limit(1);
  const parsed = z
    .array(observedVolumeSchema)
    .safeParse(check?.result?.storage);
  const observed = parsed.success
    ? parsed.data.filter(
        (volume) => volume.deployableId === appId && volume.runtimeId === appId,
      )
    : [];
  const declared = app.config.container.volumes ?? [];
  const names = [
    ...new Set([
      ...declared.map((volume) => volume.name),
      ...observed.map((volume) => volume.name),
    ]),
  ];
  return {
    checkedAt: parsed.success ? (check?.finishedAt ?? null) : null,
    serverId: app.serverId,
    serverIp: app.serverIp,
    volumes: names.map((name) => {
      const configured = declared.find((volume) => volume.name === name);
      const actual = observed.find((volume) => volume.name === name);
      return {
        name,
        mountPath: configured?.mountPath ?? actual!.mountPath,
        volumeName: actual?.volumeName ?? `towbar-${appId}-${name}`,
        status: !configured
          ? ("retained" as const)
          : !parsed.success
            ? ("unknown" as const)
            : !actual
              ? ("pending" as const)
              : actual.mounted && actual.mountPath === configured.mountPath
                ? ("mounted" as const)
                : ("not_mounted" as const),
      };
    }),
  };
}
