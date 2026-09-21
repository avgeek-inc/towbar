import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationLockKey = "towbar:migrations";

type MigrationLogger = Pick<typeof console, "error" | "info">;

export interface RunTowbarMigrationsOptions {
  databaseUrl?: string;
  logger?: MigrationLogger;
}

function resolveMigrationsFolder() {
  const candidates = [
    "/repo/packages/towbar-database/drizzle",
    "/app/packages/towbar-database/drizzle",
    path.resolve(directory, "../drizzle"),
  ];
  const folder = candidates.find((candidate) => existsSync(candidate));
  if (!folder) {
    throw new Error(
      `Towbar migrations folder not found. Checked: ${candidates.join(", ")}`,
    );
  }
  return folder;
}

export async function runTowbarMigrations(
  options: RunTowbarMigrationsOptions = {},
) {
  const databaseUrl =
    options.databaseUrl ??
    process.env.DATABASE_TOWBAR_MIGRATOR_URL ??
    process.env.DATABASE_TOWBAR_URL ??
    process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_TOWBAR_MIGRATOR_URL, DATABASE_TOWBAR_URL, or DATABASE_URL is required",
    );
  }

  const logger = options.logger ?? console;
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);
  let lockAcquired = false;
  try {
    logger.info("Acquiring Towbar migration lock");
    await client`select pg_advisory_lock(hashtext(${migrationLockKey}))`;
    lockAcquired = true;
    const [existing] = await client<
      { workspace: string | null; setup: string | null }[]
    >`
      select to_regclass('public.towbar_workspaces')::text as workspace,
             to_regclass('public.towbar_installation_setup')::text as setup`;
    if (existing?.workspace && !existing.setup)
      throw new Error(
        "Towbar v2 requires a fresh database; this schema cannot be upgraded from 1.x. Preserve the existing database and use a separate v2 installation.",
      );
    await migrate(database, { migrationsFolder: resolveMigrationsFolder() });
    logger.info("Towbar database migrations completed");
  } catch (error) {
    logger.error("Towbar database migration failed", error);
    throw error;
  } finally {
    if (lockAcquired) {
      await client`select pg_advisory_unlock(hashtext(${migrationLockKey}))`;
    }
    await client.end();
  }
}
