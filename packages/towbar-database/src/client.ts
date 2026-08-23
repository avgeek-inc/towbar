import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

export function createTowbarDatabase(databaseUrl: string, maxConnections = 10) {
  const client = postgres(databaseUrl, {
    max: maxConnections,
    onnotice: () => undefined,
  });
  const database = drizzle(client, { schema });
  return {
    client,
    database,
    async close() {
      await client.end();
    },
    async ping() {
      await client`select 1`;
    },
  };
}

export type TowbarDatabase = ReturnType<
  typeof createTowbarDatabase
>["database"];
