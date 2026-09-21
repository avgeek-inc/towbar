import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { digestValue } from "@workspace/towbar-core";
import {
  integrationWebhookDeliveries,
  repositoryWebhookCursors,
  sourceEnvironments,
  sources,
} from "@workspace/towbar-database/schema";
import { badRequest, unauthorized } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueuePreviewPullRequestEvent } from "../../infrastructure/temporal.js";
import { withActor } from "../auth/actor-context.js";
import { resolveGitLabWebhookConnection } from "../integrations/service.js";
import { requestEnvironmentSync } from "../sources/environments.js";

const projectSchema = z.object({
  id: z.number().int().positive(),
  path_with_namespace: z.string().min(3).max(512),
});
const pushSchema = z.object({
  after: z.string().regex(/^[a-f0-9]{40,64}$/u),
  checkout_sha: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/u)
    .nullable(),
  event_created_at: z.iso.datetime({ offset: true }),
  project: projectSchema,
  ref: z.string().min(1).max(1_024),
});
const mergeRequestSchema = z.object({
  event_type: z.literal("merge_request"),
  object_attributes: z.object({
    action: z.string().min(1).max(100),
    iid: z.number().int().positive(),
    state: z.string().min(1).max(100),
    updated_at: z.iso.datetime({ offset: true }),
  }),
  project: projectSchema,
});

export async function processGitLabWebhook(input: {
  body: string;
  connectionId: string;
  deliveryId: string | undefined;
  eventName: string | undefined;
  token: string | undefined;
}) {
  if (!input.deliveryId || !input.eventName || !input.token)
    throw badRequest("Required GitLab webhook headers are missing");
  const resolved = await resolveGitLabWebhookConnection(input.connectionId);
  verifyToken(input.token, resolved.connectionInput.credentials.webhookSecret);
  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    throw badRequest("GitLab webhook body is invalid JSON");
  }
  const event = parseEvent(input.eventName, payload);
  const database = getTowbarDatabase();
  let claimedCursor:
    { deliveryId: string; eventKey: string; sourceId: string } | undefined;
  const [created] = await database
    .insert(integrationWebhookDeliveries)
    .values({
      action: event.action,
      authorizationId: input.connectionId,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      occurredAt: event.occurredAt,
      payloadDigest: digestValue(input.body),
      provider: "gitlab",
    })
    .onConflictDoNothing()
    .returning({ id: integrationWebhookDeliveries.id });
  if (!created) return { accepted: true, duplicate: true, stale: false };
  try {
    const source = await findGitLabSource({
      connectionId: input.connectionId,
      fullPath: event.fullPath,
      projectId: event.projectId,
    });
    if (!source) {
      await markProcessed(created.id, null);
      return { accepted: true, duplicate: false, stale: false };
    }
    const accepted = await claimEventCursor({
      deliveryId: input.deliveryId,
      eventKey: event.eventKey,
      occurredAt: event.occurredAt,
      sourceId: source.id,
    });
    if (!accepted) {
      await markProcessed(created.id, source.id);
      return { accepted: true, duplicate: false, stale: true };
    }
    claimedCursor = {
      deliveryId: input.deliveryId,
      eventKey: event.eventKey,
      sourceId: source.id,
    };
    if (event.kind === "push" && !event.deleted) {
      const environments = await database
        .select()
        .from(sourceEnvironments)
        .where(
          and(
            eq(sourceEnvironments.sourceId, source.id),
            eq(sourceEnvironments.branch, event.branch),
            isNull(sourceEnvironments.disconnectedAt),
          ),
        );
      for (const environment of environments) {
        await withActor(
          {
            grants: [
              "repository.sync",
              "deployment.create",
              "workload.operate",
            ],
            kind: "system",
            source: "gitlab",
            workspaceId: source.workspaceId,
          },
          () =>
            requestEnvironmentSync({
              deployAfterSync: !environment.autoDeployPaused,
              environmentId: environment.id,
              expectedMappingRevision: environment.mappingRevision,
              requestedBy: null,
              sourceId: source.id,
              workspaceId: source.workspaceId,
            }),
        );
      }
    } else if (event.kind === "merge-request") {
      await enqueuePreviewPullRequestEvent({
        pullRequestNumber: event.number,
        sourceId: source.id,
      });
    }
    await markProcessed(created.id, source.id);
    return { accepted: true, duplicate: false, stale: false };
  } catch (error) {
    if (claimedCursor) {
      await database
        .delete(repositoryWebhookCursors)
        .where(
          and(
            eq(repositoryWebhookCursors.sourceId, claimedCursor.sourceId),
            eq(repositoryWebhookCursors.eventKey, claimedCursor.eventKey),
            eq(repositoryWebhookCursors.deliveryId, claimedCursor.deliveryId),
          ),
        );
    }
    await database
      .delete(integrationWebhookDeliveries)
      .where(eq(integrationWebhookDeliveries.id, created.id));
    throw error;
  }
}

function parseEvent(eventName: string, payload: unknown) {
  if (eventName === "Push Hook") {
    const push = pushSchema.parse(payload);
    const branch = push.ref.startsWith("refs/heads/")
      ? push.ref.slice("refs/heads/".length)
      : null;
    if (!branch) throw badRequest("GitLab push ref is not a branch");
    return {
      action: "push",
      branch,
      deleted: push.checkout_sha === null || /^0+$/u.test(push.after),
      eventKey: `push:${branch}`,
      fullPath: push.project.path_with_namespace,
      projectId: String(push.project.id),
      kind: "push" as const,
      occurredAt: new Date(push.event_created_at),
    };
  }
  if (eventName === "Merge Request Hook") {
    const mergeRequest = mergeRequestSchema.parse(payload);
    return {
      action: mergeRequest.object_attributes.action,
      eventKey: `merge-request:${mergeRequest.object_attributes.iid}`,
      fullPath: mergeRequest.project.path_with_namespace,
      projectId: String(mergeRequest.project.id),
      kind: "merge-request" as const,
      number: mergeRequest.object_attributes.iid,
      occurredAt: new Date(mergeRequest.object_attributes.updated_at),
    };
  }
  throw badRequest(`Unsupported GitLab webhook event: ${eventName}`);
}

async function findGitLabSource(input: {
  connectionId: string;
  fullPath: string;
  projectId: string;
}) {
  const separator = input.fullPath.lastIndexOf("/");
  if (separator <= 0) throw badRequest("GitLab project path is invalid");
  const owner = input.fullPath.slice(0, separator);
  const name = input.fullPath.slice(separator + 1);
  const database = getTowbarDatabase();
  const [source] = await database
    .select({
      id: sources.id,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      workspaceId: sources.workspaceId,
    })
    .from(sources)
    .where(
      and(
        eq(sources.provider, "gitlab"),
        eq(sources.integrationAuthorizationId, input.connectionId),
        eq(sources.providerRepositoryId, input.projectId),
        eq(sources.status, "active"),
      ),
    )
    .limit(1);
  if (!source) return null;
  if (source.repositoryOwner !== owner || source.repositoryName !== name) {
    await database
      .update(sources)
      .set({
        repositoryOwner: owner,
        repositoryName: name,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, source.id));
  }
  return source;
}

async function claimEventCursor(input: {
  deliveryId: string;
  eventKey: string;
  occurredAt: Date;
  sourceId: string;
}) {
  const result = await getTowbarDatabase().execute(sql`
    INSERT INTO ${repositoryWebhookCursors}
      (${repositoryWebhookCursors.sourceId}, ${repositoryWebhookCursors.eventKey}, ${repositoryWebhookCursors.deliveryId}, ${repositoryWebhookCursors.occurredAt}, ${repositoryWebhookCursors.updatedAt})
    VALUES (${input.sourceId}, ${input.eventKey}, ${input.deliveryId}, ${input.occurredAt}, now())
    ON CONFLICT (${repositoryWebhookCursors.sourceId}, ${repositoryWebhookCursors.eventKey})
    DO UPDATE SET
      ${repositoryWebhookCursors.deliveryId} = EXCLUDED.delivery_id,
      ${repositoryWebhookCursors.occurredAt} = EXCLUDED.occurred_at,
      ${repositoryWebhookCursors.updatedAt} = now()
    WHERE ${repositoryWebhookCursors.occurredAt} < EXCLUDED.occurred_at
    RETURNING ${repositoryWebhookCursors.deliveryId}
  `);
  return result.length > 0;
}

async function markProcessed(id: string, sourceId: string | null) {
  await getTowbarDatabase()
    .update(integrationWebhookDeliveries)
    .set({ processedAt: new Date(), sourceId })
    .where(eq(integrationWebhookDeliveries.id, id));
}

function verifyToken(supplied: string, expected: string) {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw unauthorized("GitLab webhook token is invalid");
}
