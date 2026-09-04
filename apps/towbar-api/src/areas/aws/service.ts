import { randomUUID } from "node:crypto";

import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import { workspaceAwsCredentials } from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { notFound, serviceUnavailable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

const awsCredentialPayloadSchema = z
  .object({
    accessKeyId: z.string().min(16).max(128),
    secretAccessKey: z.string().min(20).max(256),
  })
  .strict();

type AwsCredentialPayload = z.infer<typeof awsCredentialPayloadSchema>;

export async function getAwsCredentialMetadata(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({
      accessKeyIdSuffix: workspaceAwsCredentials.accessKeySuffix,
      createdAt: workspaceAwsCredentials.createdAt,
      lastVerifiedAt: workspaceAwsCredentials.verifiedAt,
      region: workspaceAwsCredentials.region,
      status: workspaceAwsCredentials.verificationStatus,
      updatedAt: workspaceAwsCredentials.updatedAt,
      verificationMessage: workspaceAwsCredentials.verificationMessage,
    })
    .from(workspaceAwsCredentials)
    .where(eq(workspaceAwsCredentials.workspaceId, workspaceId))
    .limit(1);
  return credential ?? null;
}

export async function hasAwsCredentials(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({ id: workspaceAwsCredentials.id })
    .from(workspaceAwsCredentials)
    .where(eq(workspaceAwsCredentials.workspaceId, workspaceId))
    .limit(1);
  return Boolean(credential);
}

export async function saveAwsCredentials(input: {
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
  workspaceId: string;
}) {
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
    .select({ id: workspaceAwsCredentials.id })
    .from(workspaceAwsCredentials)
    .where(eq(workspaceAwsCredentials.workspaceId, input.workspaceId))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const encryptedPayload = encryptCredential({
    associatedData: awsCredentialAssociatedData(input.workspaceId, id),
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: payload,
  });
  const values = {
    accessKeySuffix: payload.accessKeyId.slice(-4),
    encryptedPayload,
    id,
    region: input.region,
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
      .update(workspaceAwsCredentials)
      .set(values)
      .where(eq(workspaceAwsCredentials.id, existing.id));
  } else {
    await database.insert(workspaceAwsCredentials).values(values);
  }
  return await getAwsCredentialMetadata(input.workspaceId);
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

export async function deleteAwsCredentials(workspaceId: string) {
  await getTowbarDatabase()
    .delete(workspaceAwsCredentials)
    .where(eq(workspaceAwsCredentials.workspaceId, workspaceId));
}

export async function getDecryptedAwsCredential(input: {
  workspaceId: string;
}) {
  const [credential] = await getTowbarDatabase()
    .select()
    .from(workspaceAwsCredentials)
    .where(eq(workspaceAwsCredentials.workspaceId, input.workspaceId))
    .limit(1);
  if (!credential) throw notFound("AWS credentials");
  const payload = awsCredentialPayloadSchema.parse(
    decryptCredential({
      associatedData: awsCredentialAssociatedData(
        input.workspaceId,
        credential.id,
      ),
      envelope: credential.encryptedPayload,
      masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    }),
  );
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

function awsCredentialAssociatedData(workspaceId: string, recordId: string) {
  return `${workspaceId}:workspace:aws-credentials:${recordId}`;
}
