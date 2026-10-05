import { createTowbarDatabase } from "@workspace/towbar-database";

import { getEnv } from "../env.js";

let connection: ReturnType<typeof createTowbarDatabase> | undefined;
let reportingLocks: ReturnType<typeof createTowbarDatabase> | undefined;

export function getTowbarDatabase() {
  connection ??= createTowbarDatabase(getEnv().DATABASE_TOWBAR_URL);
  return connection.database;
}

export function getPreviewReportingLockDatabase() {
  // Reporting holds an advisory lock during network requests. A separate,
  // bounded pool leaves the main pool available for publication queries.
  reportingLocks ??= createTowbarDatabase(getEnv().DATABASE_TOWBAR_URL, 2);
  return reportingLocks.database;
}

export async function pingDatabase() {
  connection ??= createTowbarDatabase(getEnv().DATABASE_TOWBAR_URL);
  await connection.ping();
}

export async function closeDatabase() {
  const current = connection;
  const locks = reportingLocks;
  connection = undefined;
  reportingLocks = undefined;
  await locks?.close();
  await current?.close();
}

export type AuthDatabase =
  | ReturnType<typeof getTowbarDatabase>
  | Parameters<
      Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
    >[0];
