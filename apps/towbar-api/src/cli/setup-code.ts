import { issueSetupCode } from "../areas/auth/service.js";
import { getEnv } from "../env.js";
import { closeDatabase } from "../infrastructure/database.js";
try {
  const code = await issueSetupCode();
  process.stdout.write(
    `Complete Towbar setup at ${getEnv().TOWBAR_APP_BASE_URL}/setup#code=${encodeURIComponent(code)}\n`,
  );
} finally {
  await closeDatabase();
}
