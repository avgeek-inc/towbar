import { eq } from "drizzle-orm";
import { upgradeLeases } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

// The database trigger takes the same row lock as the host's readiness check.
// Leases deliberately never expire: a lost worker may still be changing a host.
export async function beginUpgradeLease(id: string, kind: string) {
  await getTowbarDatabase()
    .insert(upgradeLeases)
    .values({ id, kind })
    .onConflictDoNothing();
}

export async function endUpgradeLease(id: string) {
  await getTowbarDatabase()
    .delete(upgradeLeases)
    .where(eq(upgradeLeases.id, id));
}
