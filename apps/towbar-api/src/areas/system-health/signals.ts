import { eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { systemHealthSignals } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";

export const systemHealthStatusSchema = z.enum([
  "healthy",
  "attention",
  "critical",
  "unknown",
]);

export type SystemHealthSignal = typeof systemHealthSignals.$inferSelect;

export async function listSystemHealthSignals(workspaceId: string) {
  return await getTowbarDatabase()
    .select()
    .from(systemHealthSignals)
    .where(
      or(
        isNull(systemHealthSignals.workspaceId),
        eq(systemHealthSignals.workspaceId, workspaceId),
      ),
    );
}

export async function recordSystemHealthSignal(input: {
  component: string;
  details: Record<string, boolean | number | string | null>;
  key: string;
  message: string;
  status: z.infer<typeof systemHealthStatusSchema>;
  version?: string;
  workspaceId: string | null;
}) {
  const checkedAt = new Date();
  await getTowbarDatabase()
    .insert(systemHealthSignals)
    .values({ ...input, checkedAt })
    .onConflictDoUpdate({
      target: systemHealthSignals.key,
      set: {
        checkedAt,
        details: input.details,
        message: input.message,
        status: input.status,
        version: input.version ?? null,
      },
    });
}

export async function recordMaintenanceHeartbeat(input: {
  details: {
    backupsQueued: number;
    checksQueued: number;
    previewCleanupsQueued: number;
  };
  version: string;
}) {
  await recordSystemHealthSignal({
    component: "worker",
    details: input.details,
    key: "worker-maintenance",
    message:
      "The worker completed a scheduled maintenance sweep through Temporal.",
    status: "healthy",
    version: input.version,
    workspaceId: null,
  });
}
