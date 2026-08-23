import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createOpaqueToken,
  hashOpaqueToken,
} from "@workspace/towbar-core/security";
import { createTowbarDatabase } from "@workspace/towbar-database";
import { passwordResetTokens, users } from "@workspace/towbar-database/schema";

const input = z
  .object({
    databaseUrl: z.string().url(),
    email: z
      .string()
      .email()
      .transform((value) => value.trim().toLowerCase()),
  })
  .parse({
    databaseUrl:
      process.env.DATABASE_TOWBAR_MIGRATOR_URL ??
      process.env.DATABASE_TOWBAR_URL,
    email: process.env.TOWBAR_RECOVERY_EMAIL,
  });

const connection = createTowbarDatabase(input.databaseUrl, 1);
try {
  const [user] = await connection.database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (!user) throw new Error("Towbar user was not found");
  const token = createOpaqueToken();
  await connection.database.insert(passwordResetTokens).values({
    expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    tokenHash: hashOpaqueToken(token),
    userId: user.id,
  });
  process.stdout.write(`${token}\n`);
} finally {
  await connection.close();
}
