import { randomUUID } from "node:crypto";

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
  parseSecretReference,
  stableStringify,
  validateSecretObject,
} from "@workspace/towbar-core";
import { sourceAwsCredentials } from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import {
  conflict,
  notFound,
  serviceUnavailable,
  unprocessable,
} from "../../http/errors.js";
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

export type AwsCredentialPayload = z.infer<typeof awsCredentialPayloadSchema>;
export type EnvironmentSecretPurpose = "build" | "deployment";

export type EnvironmentSecretMutation = {
  delete: string[];
  expectedVersionId: string;
  set: Record<string, string>;
};

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

export async function resolveAwsSecret(input: {
  secretReference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const { client, reference } = await createSecretsManagerContext(input);
  try {
    return (await readAwsSecretValue(client, reference.reference)).value;
  } finally {
    client.destroy();
  }
}

export async function inspectAwsEnvironmentSecret(input: {
  purpose: EnvironmentSecretPurpose;
  secretReference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const { client, reference } = await createSecretsManagerContext(input);
  try {
    const current = await readAwsSecretValue(client, reference.reference);
    const value = validateSecretObject(current.value, input.purpose);
    return {
      changedAt: current.changedAt,
      editable: current.storage === "string",
      keys: Object.keys(value).sort((left, right) => left.localeCompare(right)),
      versionId: current.versionId,
    };
  } finally {
    client.destroy();
  }
}

export async function revealAwsEnvironmentSecret(input: {
  purpose: EnvironmentSecretPurpose;
  secretReference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const { client, reference } = await createSecretsManagerContext(input);
  try {
    const current = await readAwsSecretValue(client, reference.reference);
    return {
      changedAt: current.changedAt,
      values: validateSecretObject(current.value, input.purpose),
      versionId: current.versionId,
    };
  } finally {
    client.destroy();
  }
}

export async function updateAwsEnvironmentSecret(input: {
  mutation: EnvironmentSecretMutation;
  purpose: EnvironmentSecretPurpose;
  secretReference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const { client, reference } = await createSecretsManagerContext(input);
  try {
    const current = await readAwsSecretValue(client, reference.reference);
    if (current.storage !== "string") {
      throw unprocessable(
        "Binary AWS secrets cannot be edited through Towbar",
        "SECRET_NOT_EDITABLE",
      );
    }
    if (current.versionId !== input.mutation.expectedVersionId) {
      throw conflict(
        "This secret changed after it was loaded. Refresh before saving.",
        "SECRET_VERSION_CHANGED",
      );
    }
    const next = applyEnvironmentSecretMutation(
      validateSecretObject(current.value, input.purpose),
      input.mutation,
      input.purpose,
    );
    const secretString = stableStringify(next);
    if (Buffer.byteLength(secretString, "utf8") > 65_536) {
      throw unprocessable(
        "The resulting AWS secret exceeds the 65,536-byte limit",
        "SECRET_TOO_LARGE",
      );
    }
    let response;
    try {
      response = await client.send(
        new PutSecretValueCommand({
          ClientRequestToken: randomUUID(),
          SecretId: reference.reference,
          SecretString: secretString,
        }),
      );
    } catch (error) {
      throw serviceUnavailable(
        `AWS secret '${reference.reference}' could not be updated`,
        { cause: error },
      );
    }
    if (!response.VersionId) {
      throw serviceUnavailable(
        `AWS secret '${reference.reference}' did not return a version`,
      );
    }
    return {
      changedAt: new Date(),
      editable: true,
      keys: Object.keys(next).sort((left, right) => left.localeCompare(right)),
      versionId: response.VersionId,
    };
  } finally {
    client.destroy();
  }
}

export function applyEnvironmentSecretMutation(
  current: Record<string, string>,
  mutation: Pick<EnvironmentSecretMutation, "delete" | "set">,
  purpose: EnvironmentSecretPurpose,
) {
  const next = Object.assign(
    Object.create(null) as Record<string, string>,
    current,
  );
  for (const key of mutation.delete) delete next[key];
  for (const [key, value] of Object.entries(mutation.set)) next[key] = value;
  return validateSecretObject(next, purpose);
}

async function createSecretsManagerContext(input: {
  secretReference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const reference = parseSecretReference(input.secretReference);
  if (reference.provider !== "aws") {
    throw new Error(`Unsupported secret provider '${reference.provider}'`);
  }
  const credential = await getDecryptedAwsCredential(input);
  return {
    client: new SecretsManagerClient({
      credentials: createAwsSdkCredentials(credential.payload),
      region: credential.region,
    }),
    reference,
  };
}

async function readAwsSecretValue(
  client: SecretsManagerClient,
  secretId: string,
) {
  let response;
  try {
    response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
  } catch (error) {
    throw serviceUnavailable(`AWS secret '${secretId}' could not be resolved`, {
      cause: error,
    });
  }
  const storage = response.SecretString ? "string" : "binary";
  const content = response.SecretString
    ? response.SecretString
    : response.SecretBinary
      ? Buffer.from(response.SecretBinary).toString("utf8")
      : null;
  if (!content) {
    throw unprocessable(
      `AWS secret '${secretId}' has no value`,
      "SECRET_VALUE_MISSING",
    );
  }
  if (!response.VersionId) {
    throw serviceUnavailable(`AWS secret '${secretId}' has no version`);
  }
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw unprocessable(
      `AWS secret '${secretId}' is not valid JSON`,
      "INVALID_SECRET_VALUE",
    );
  }
  return {
    changedAt: response.CreatedDate ?? null,
    storage,
    value,
    versionId: response.VersionId,
  } as const;
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
