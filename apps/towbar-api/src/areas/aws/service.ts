import { randomUUID } from "node:crypto";

import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import { sourceAwsCredentials } from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { notFound, serviceUnavailable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getSource } from "../sources/service.js";

const awsCredentialPayloadSchema = z
  .object({
    accessKeyId: z.string().min(16).max(128),
    secretAccessKey: z.string().min(20).max(256),
  })
  .strict();

const storedAwsCredentialPayloadSchema = awsCredentialPayloadSchema
  .extend({ $source: z.unknown().optional() })
  .strict();

type AwsCredentialPayload = z.infer<typeof awsCredentialPayloadSchema>;
export async function getAwsCredentialMetadata(input: {
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  const [credential] = await getTowbarDatabase()
    .select({
      accessKeyIdSuffix: sourceAwsCredentials.accessKeySuffix,
      createdAt: sourceAwsCredentials.createdAt,
      lastVerifiedAt: sourceAwsCredentials.verifiedAt,
      region: sourceAwsCredentials.region,
      status: sourceAwsCredentials.verificationStatus,
      updatedAt: sourceAwsCredentials.updatedAt,
      verificationMessage: sourceAwsCredentials.verificationMessage,
    })
    .from(sourceAwsCredentials)
    .where(
      and(
        eq(sourceAwsCredentials.sourceId, input.sourceId),
        eq(sourceAwsCredentials.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  return credential ?? null;
}

export async function saveAwsCredentials(input: {
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  const payload = awsCredentialPayloadSchema.parse({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
  });
  const identity = await validateAwsCredentials({
    payload,
    region: input.region,
  });
  const verifiedAt = new Date();
  const database = getTowbarDatabase();
  const [existing] = await database
    .select({ id: sourceAwsCredentials.id })
    .from(sourceAwsCredentials)
    .where(eq(sourceAwsCredentials.sourceId, input.sourceId))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const encryptedPayload = encryptCredential({
    associatedData: awsCredentialAssociatedData(
      input.workspaceId,
      input.sourceId,
      id,
    ),
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: payload,
  });
  const values = {
    accessKeySuffix: payload.accessKeyId.slice(-4),
    encryptedPayload,
    id,
    region: input.region,
    sourceId: input.sourceId,
    updatedAt: new Date(),
    verificationMessage: identity.Account
      ? `AWS account ${identity.Account}`
      : "AWS identity verified",
    verificationStatus: "verified" as const,
    verifiedAt,
    workspaceId: input.workspaceId,
  };
  if (existing) {
    await database
      .update(sourceAwsCredentials)
      .set(values)
      .where(eq(sourceAwsCredentials.id, existing.id));
  } else {
    await database.insert(sourceAwsCredentials).values(values);
  }
  return await getAwsCredentialMetadata(input);
}

async function validateAwsCredentials(input: {
  payload: AwsCredentialPayload;
  region: string;
}) {
  const client = new STSClient({
    credentials: createAwsSdkCredentials(input.payload),
    region: input.region,
  });
  try {
    return await client.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw serviceUnavailable("AWS rejected these credentials", {
      cause: error,
    });
  } finally {
    client.destroy();
  }
}

export async function deleteAwsCredentials(input: {
  sourceId: string;
  workspaceId: string;
}) {
  await getTowbarDatabase()
    .delete(sourceAwsCredentials)
    .where(
      and(
        eq(sourceAwsCredentials.sourceId, input.sourceId),
        eq(sourceAwsCredentials.workspaceId, input.workspaceId),
      ),
    );
}

export async function getDecryptedAwsCredential(input: {
  sourceId: string;
  workspaceId: string;
}) {
  const [credential] = await getTowbarDatabase()
    .select()
    .from(sourceAwsCredentials)
    .where(
      and(
        eq(sourceAwsCredentials.sourceId, input.sourceId),
        eq(sourceAwsCredentials.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!credential) throw notFound("AWS credentials");
  const masterKey = parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY);
  const associatedData = awsCredentialAssociatedData(
    input.workspaceId,
    input.sourceId,
    credential.id,
  );
  let decrypted: unknown;
  let usedLegacyAssociatedData = false;
  try {
    decrypted = decryptCredential({
      associatedData,
      envelope: credential.encryptedPayload,
      masterKey,
    });
  } catch {
    usedLegacyAssociatedData = true;
    decrypted = decryptCredential({
      associatedData: legacyAwsCredentialAssociatedData(
        input.workspaceId,
        credential.id,
      ),
      envelope: credential.encryptedPayload,
      masterKey,
    });
  }
  const hasAwsSdkMetadata =
    typeof decrypted === "object" &&
    decrypted !== null &&
    Object.hasOwn(decrypted, "$source");
  const payload = parseStoredAwsCredentialPayload(decrypted);
  if (usedLegacyAssociatedData || hasAwsSdkMetadata) {
    await getTowbarDatabase()
      .update(sourceAwsCredentials)
      .set({
        encryptedPayload: encryptCredential({
          associatedData,
          masterKey,
          value: payload,
        }),
        updatedAt: new Date(),
      })
      .where(eq(sourceAwsCredentials.id, credential.id));
  }
  return {
    id: credential.id,
    payload,
    region: credential.region,
  };
}

export function createAwsSdkCredentials(payload: AwsCredentialPayload) {
  return {
    accessKeyId: payload.accessKeyId,
    secretAccessKey: payload.secretAccessKey,
  };
}

export function parseStoredAwsCredentialPayload(value: unknown) {
  const stored = storedAwsCredentialPayloadSchema.parse(value);
  return awsCredentialPayloadSchema.parse({
    accessKeyId: stored.accessKeyId,
    secretAccessKey: stored.secretAccessKey,
  });
}

function awsCredentialAssociatedData(
  workspaceId: string,
  sourceId: string,
  recordId: string,
) {
  return `${workspaceId}:source:${sourceId}:aws-credentials:${recordId}`;
}

function legacyAwsCredentialAssociatedData(
  workspaceId: string,
  recordId: string,
) {
  return `${workspaceId}:aws-credentials:${recordId}`;
}
