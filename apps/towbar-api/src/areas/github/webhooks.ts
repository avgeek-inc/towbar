import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { digestValue } from "@workspace/towbar-core";
import {
  githubInstallations,
  githubWebhookDeliveries,
  sources,
} from "@workspace/towbar-database/schema";

import { requireGitHubEnv } from "../../env.js";
import { badRequest, unauthorized } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requestSourceSync } from "../sources/service.js";

const pushSchema = z.object({
  after: z.string().regex(/^[a-f0-9]{40}$/u),
  deleted: z.boolean(),
  installation: z.object({ id: z.number().int().positive() }),
  ref: z.string(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
});
const installationSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
});

export async function processGitHubWebhook(input: {
  body: string;
  deliveryId: string | undefined;
  eventName: string | undefined;
  signature: string | undefined;
}) {
  if (!input.deliveryId || !input.eventName || !input.signature) {
    throw badRequest("Required GitHub webhook headers are missing");
  }
  verifyWebhookSignature(input.body, input.signature);
  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    throw badRequest("GitHub webhook body is invalid JSON");
  }
  const database = getTowbarDatabase();
  const created = await database
    .insert(githubWebhookDeliveries)
    .values({
      action:
        typeof payload === "object" && payload && "action" in payload
          ? String(payload.action).slice(0, 100)
          : null,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      payloadDigest: digestValue(input.body),
    })
    .onConflictDoNothing()
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId });
  if (created.length === 0) return { accepted: true, duplicate: true };

  try {
    let sourceId: string | null = null;
    if (input.eventName === "push") {
      const push = pushSchema.parse(payload);
      const branch = push.ref.startsWith("refs/heads/")
        ? push.ref.slice("refs/heads/".length)
        : null;
      if (branch && !push.deleted && !/^0{40}$/u.test(push.after)) {
        const [source] = await database
          .select({ id: sources.id, workspaceId: sources.workspaceId })
          .from(sources)
          .innerJoin(
            githubInstallations,
            eq(githubInstallations.id, sources.githubInstallationId),
          )
          .where(
            and(
              eq(
                githubInstallations.installationId,
                String(push.installation.id),
              ),
              eq(sources.repositoryOwner, push.repository.owner.login),
              eq(sources.repositoryName, push.repository.name),
              eq(sources.branch, branch),
              eq(sources.status, "active"),
            ),
          )
          .limit(1);
        if (source) {
          sourceId = source.id;
          await requestSourceSync({
            requestedBy: null,
            sourceId: source.id,
            workspaceId: source.workspaceId,
          });
        }
      }
    } else if (input.eventName === "installation") {
      const installation = installationSchema.parse(payload);
      if (["deleted", "suspend"].includes(installation.action)) {
        await database
          .update(githubInstallations)
          .set({ suspendedAt: new Date(), updatedAt: new Date() })
          .where(
            eq(
              githubInstallations.installationId,
              String(installation.installation.id),
            ),
          );
      }
      if (installation.action === "unsuspend") {
        await database
          .update(githubInstallations)
          .set({ suspendedAt: null, updatedAt: new Date() })
          .where(
            eq(
              githubInstallations.installationId,
              String(installation.installation.id),
            ),
          );
      }
    }
    await database
      .update(githubWebhookDeliveries)
      .set({ processedAt: new Date(), sourceId })
      .where(eq(githubWebhookDeliveries.deliveryId, input.deliveryId));
    return { accepted: true, duplicate: false };
  } catch (error) {
    await database
      .delete(githubWebhookDeliveries)
      .where(eq(githubWebhookDeliveries.deliveryId, input.deliveryId));
    throw error;
  }
}

function verifyWebhookSignature(body: string, supplied: string) {
  const expected = `sha256=${createHmac(
    "sha256",
    requireGitHubEnv().webhookSecret,
  )
    .update(body)
    .digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw unauthorized("GitHub webhook signature is invalid");
  }
}
