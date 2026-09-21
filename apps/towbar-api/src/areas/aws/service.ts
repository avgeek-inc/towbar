import {
  awsConnectionConfigurationSchema,
  awsConnectionCredentialsSchema,
} from "@workspace/towbar-core";
import type { z } from "zod";

import { notFound } from "../../http/errors.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

export const defaultAwsIntegrationSlug = "aws";

export function getAwsCredentialMetadata(_workspaceId: string) {
  const connection = getRuntimeIntegration("aws");
  if (!connection || connection.provider !== "aws")
    return Promise.resolve(null);
  const configuration = awsConnectionConfigurationSchema.parse(
    connection.configuration,
  );
  const credentials = awsConnectionCredentialsSchema.parse(
    connection.credentials,
  );
  return Promise.resolve({
    accessKeyId: credentials.accessKeyId,
    accessKeyIdSuffix: credentials.accessKeyId.slice(-4),
    lastVerifiedAt: null,
    region: configuration.region,
    source: "environment" as const,
    status: "verified" as const,
    verificationMessage: "Configured by the Towbar runtime environment",
  });
}

export function hasAwsCredentials(_workspaceId: string) {
  return Promise.resolve(Boolean(getRuntimeIntegration("aws")));
}

export function getDecryptedAwsCredential(input: { workspaceId: string }) {
  return Promise.resolve().then(() => {
    void input;
    const connection = getRuntimeIntegration("aws");
    if (!connection || connection.provider !== "aws")
      throw notFound("AWS credentials");
    return {
      id: "environment",
      payload: awsConnectionCredentialsSchema.parse(connection.credentials),
      region: awsConnectionConfigurationSchema.parse(connection.configuration)
        .region,
    };
  });
}

export function createAwsSdkCredentials(
  payload: z.infer<typeof awsConnectionCredentialsSchema>,
) {
  return {
    accessKeyId: payload.accessKeyId,
    secretAccessKey: payload.secretAccessKey,
  };
}
