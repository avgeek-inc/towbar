import { sql } from "drizzle-orm";
import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function withPreviewLifecycleLock<T>(
  input: { sourceId: string; pullRequestNumber: number },
  operation: () => Promise<T>,
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const key = `preview-lifecycle:${input.sourceId}:${input.pullRequestNumber}`;
    const [lock] = await transaction.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as acquired`,
    );
    if (!lock?.acquired)
      throw conflict(
        "This pull request is already being reconciled. Retry shortly.",
        "PREVIEW_RECONCILIATION_BUSY",
      );
    return operation();
  });
}
