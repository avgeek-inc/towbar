import { randomBytes } from "node:crypto";
import { resetAdminPassword } from "../areas/auth/service.js";
import { closeDatabase } from "../infrastructure/database.js";
import { recoveryArguments } from "./recovery-arguments.js";

try {
  const options = recoveryArguments(process.argv.slice(2), "admin");
  const temporaryPassword = randomBytes(24).toString("base64url");
  await resetAdminPassword({
    ...options,
    temporaryPassword,
  });
  process.stdout.write(
    `Admin recovery completed. Existing sessions and personal API keys were revoked.\nTemporary password (shown once): ${temporaryPassword}\nChoose a new password after signing in.\n`,
  );
  if (options.newEmail)
    process.stdout.write(
      "Sign in with the new email address and verify it in My Settings.\n",
    );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Admin recovery failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
