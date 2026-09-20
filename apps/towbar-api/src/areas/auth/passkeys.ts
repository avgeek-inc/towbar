import { desc, eq } from "drizzle-orm";
import { authPasskeys } from "@workspace/towbar-database/schema";
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
