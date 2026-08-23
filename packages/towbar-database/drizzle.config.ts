import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_TOWBAR_MIGRATOR_URL ??
      process.env.DATABASE_TOWBAR_URL ??
      process.env.DATABASE_URL!,
  },
});
