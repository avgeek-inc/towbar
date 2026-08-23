import { createTowbarDatabase } from "@workspace/towbar-database";

import { getEnv } from "../env.js";

let connection: ReturnType<typeof createTowbarDatabase> | undefined;

export function getTowbarDatabase() {
  connection ??= createTowbarDatabase(getEnv().DATABASE_TOWBAR_URL);
  return connection.database;
}

export async function pingDatabase() {
  connection ??= createTowbarDatabase(getEnv().DATABASE_TOWBAR_URL);
  await connection.ping();
}

export async function closeDatabase() {
  if (!connection) return;
  const current = connection;
  connection = undefined;
  await current.close();
}
