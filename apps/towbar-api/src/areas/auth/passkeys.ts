import { desc, eq, sql } from "drizzle-orm";
import { authPasskeys, users } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export function listPersonalPasskeys(userId: string) {
  return getTowbarDatabase()
    .select({
      id: authPasskeys.id,
      name: authPasskeys.name,
      createdAt: authPasskeys.createdAt,
    })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId))
    .orderBy(desc(authPasskeys.createdAt));
}

export const passkeyEnabled = sql<boolean>`exists (select 1 from ${authPasskeys} where ${authPasskeys.userId} = ${users.id})`;
