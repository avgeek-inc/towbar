import { resetUserMfa } from "../areas/auth/operator-recovery.js";
import { closeDatabase } from "../infrastructure/database.js";
import { recoveryArguments } from "./recovery-arguments.js";

try {
  const options = recoveryArguments(process.argv.slice(2), "mfa");
  await resetUserMfa(options);
  process.stdout.write(
    "Authenticator and recovery codes reset. Existing sessions and personal API keys were revoked.\n",
  );
  process.stdout.write(
    options.removePasskeys
      ? "Registered passkeys were removed.\n"
      : "Registered passkeys were retained.\n",
  );
  process.stdout.write(
    "Sign in with the existing password and set up two-factor authentication again.\n",
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Account recovery failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
