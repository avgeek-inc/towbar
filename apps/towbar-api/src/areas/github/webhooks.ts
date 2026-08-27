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
import { enqueuePreviewPullRequestEvent } from "../../infrastructure/temporal.js";
import { requestSourceSync } from "../sources/service.js";
import { shouldReconcilePreviewPullRequest } from "./webhook-events.js";

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
const pullRequestSchema = z.object({
  action: z.string().min(1).max(100),
  installation: z.object({ id: z.number().int().positive() }),
  number: z.number().int().positive().max(2_147_483_647),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
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
    const sourceId =
      input.eventName === "push"
        ? await processPush(payload)
        : input.eventName === "pull_request"
          ? await processPullRequest(payload)
          : input.eventName === "installation"
            ? await processInstallation(payload)
            : null;
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

async function processPush(payload: unknown) {
  const push = pushSchema.parse(payload);
  const branch = push.ref.startsWith("refs/heads/")
    ? push.ref.slice("refs/heads/".length)
    : null;
  if (!branch) return null;
  const matchingSources = await findActiveSources({
    installationId: push.installation.id,
    repositoryName: push.repository.name,
    repositoryOwner: push.repository.owner.login,
  });
  const deleted = isDeletedPush(push);
  for (const source of matchingSources) {
    if (source.branch !== branch || deleted) continue;
    await requestSourceSync({
      requestedBy: null,
      sourceId: source.id,
      workspaceId: source.workspaceId,
    });
  }
  return matchingSources[0]?.id ?? null;
}

async function processPullRequest(payload: unknown) {
  const pullRequest = pullRequestSchema.parse(payload);
  if (!shouldReconcilePreviewPullRequest(pullRequest.action)) return null;
  const matchingSources = await findActiveSources({
    installationId: pullRequest.installation.id,
    repositoryName: pullRequest.repository.name,
    repositoryOwner: pullRequest.repository.owner.login,
  });
  for (const source of matchingSources) {
    await enqueuePreviewPullRequestEvent({
      pullRequestNumber: pullRequest.number,
      sourceId: source.id,
    });
  }
  return matchingSources[0]?.id ?? null;
}

async function findActiveSources(input: {
  installationId: number;
  repositoryName: string;
  repositoryOwner: string;
}) {
  return await getTowbarDatabase()
    .select({
      branch: sources.branch,
      id: sources.id,
      workspaceId: sources.workspaceId,
    })
    .from(sources)
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(
      and(
        eq(githubInstallations.installationId, String(input.installationId)),
        eq(sources.repositoryOwner, input.repositoryOwner),
        eq(sources.repositoryName, input.repositoryName),
        eq(sources.status, "active"),
      ),
    )
    .orderBy(sources.createdAt);
}

async function processInstallation(payload: unknown) {
  const installation = installationSchema.parse(payload);
  const suspendedAt = ["deleted", "suspend"].includes(installation.action)
    ? new Date()
    : installation.action === "unsuspend"
      ? null
      : undefined;
  if (suspendedAt === undefined) return null;
  await getTowbarDatabase()
    .update(githubInstallations)
    .set({ suspendedAt, updatedAt: new Date() })
    .where(
      eq(
        githubInstallations.installationId,
        String(installation.installation.id),
      ),
    );
  return null;
}

function isDeletedPush(push: z.infer<typeof pushSchema>) {
  return push.deleted || /^0{40}$/u.test(push.after);
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
