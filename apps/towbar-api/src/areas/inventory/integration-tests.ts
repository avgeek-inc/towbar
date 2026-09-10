import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TestContext } from "node:test";
import type { getTowbarDatabase } from "../../infrastructure/database.js";

export async function testInventory({
  t,
  db,
  workspaceId,
  otherWorkspaceId,
  sourceId,
  serverId,
}: {
  t: TestContext;
  db: ReturnType<typeof getTowbarDatabase>;
  workspaceId: string;
  otherWorkspaceId: string;
  sourceId: string;
  serverId: string;
}) {
  await t.test(
    "inventory latest statuses and counts stay workspace scoped",
    async () => {
      const { serverChecks, sourceSyncs } =
        await import("@workspace/towbar-database/schema");
      const { listSources } = await import("../sources/service.js");
      const { listServers } = await import("../servers/service.js");
      const { listApps } = await import("../apps/service.js");
      const {
        filterSources,
        sourceFilters,
        filterServers,
        serverFilters,
        filterWorkloads,
        workloadFilters,
      } = await import("@workspace/towbar-core/inventory");
      const checkId = randomUUID();
      const syncId = randomUUID();
      try {
        await db.insert(serverChecks).values({
          id: checkId,
          serverId,
          status: "failed",
          createdAt: new Date("2099-01-01"),
        });
        await db.insert(sourceSyncs).values({
          id: syncId,
          sourceId,
          status: "failed",
          createdAt: new Date("2099-01-01"),
        });
        const filteredSources = filterSources(
          await listSources(workspaceId),
          sourceFilters.parse({ sync: "failed", view: "attention" }),
        );
        assert(filteredSources.items.some((item) => item.id === sourceId));
        const filteredServers = filterServers(
          await listServers(workspaceId),
          serverFilters.parse({ health: "unhealthy" }),
        );
        assert(filteredServers.items.some((item) => item.id === serverId));
        assert(
          !(await listSources(otherWorkspaceId)).some(
            (item) => item.id === sourceId,
          ),
        );
        assert(
          !(await listServers(otherWorkspaceId)).some(
            (item) => item.id === serverId,
          ),
        );
        assert.equal(
          filterWorkloads(
            await listApps(otherWorkspaceId),
            workloadFilters.parse({ sourceId }),
          ).items.length,
          0,
        );
      } finally {
        await db.delete(serverChecks).where(eq(serverChecks.id, checkId));
        await db.delete(sourceSyncs).where(eq(sourceSyncs.id, syncId));
      }
    },
  );
}
