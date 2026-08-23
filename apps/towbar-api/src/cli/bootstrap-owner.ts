import { count } from "drizzle-orm";
import { z } from "zod";

import { hashPassword } from "@workspace/towbar-core/security";
import { createTowbarDatabase } from "@workspace/towbar-database";
import {
  passwordCredentials,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";

const inputSchema = z.object({
  databaseUrl: z.string().url(),
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(1_024),
  workspaceName: z.string().trim().min(1).max(120),
  workspaceSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/),
});

const input = inputSchema.parse({
  databaseUrl:
    process.env.DATABASE_TOWBAR_MIGRATOR_URL ?? process.env.DATABASE_TOWBAR_URL,
  email: process.env.TOWBAR_BOOTSTRAP_EMAIL,
  name: process.env.TOWBAR_BOOTSTRAP_NAME ?? "Towbar Owner",
  password: process.env.TOWBAR_BOOTSTRAP_PASSWORD,
  workspaceName: process.env.TOWBAR_BOOTSTRAP_WORKSPACE_NAME ?? "Towbar",
  workspaceSlug: process.env.TOWBAR_BOOTSTRAP_WORKSPACE_SLUG ?? "towbar",
});

const connection = createTowbarDatabase(input.databaseUrl, 1);
try {
  const passwordHash = await hashPassword(input.password);
  const result = await connection.database.transaction(async (transaction) => {
    const [existingCount] = await transaction
      .select({ value: count() })
      .from(users);
    if ((existingCount?.value ?? 0) > 0) {
      throw new Error(
        "Towbar already has a user. Bootstrap is intentionally single-use",
      );
    }

    const [user] = await transaction
      .insert(users)
      .values({ displayName: input.name, email: input.email })
      .returning({ id: users.id });
    if (!user) throw new Error("Failed to create Towbar owner");

    const [workspace] = await transaction
      .insert(workspaces)
      .values({ name: input.workspaceName, slug: input.workspaceSlug })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Failed to create Towbar workspace");

    await transaction.insert(passwordCredentials).values({
      passwordHash,
      userId: user.id,
    });
    await transaction.insert(workspaceMembers).values({
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    });
    return { userId: user.id, workspaceId: workspace.id };
  });
  process.stdout.write(
    `Created Towbar owner ${input.email} in workspace ${result.workspaceId}\n`,
  );
} finally {
  await connection.close();
}
