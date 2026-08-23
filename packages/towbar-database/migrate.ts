import { runTowbarMigrations } from "./src/migrate.js";

const databaseUrl =
  process.env.DATABASE_TOWBAR_MIGRATOR_URL ?? process.env.DATABASE_TOWBAR_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_TOWBAR_MIGRATOR_URL or DATABASE_TOWBAR_URL is required",
  );
  process.exitCode = 1;
} else {
  await runTowbarMigrations({ databaseUrl });
}
