import { eq } from "drizzle-orm";

import { integrationInstallations } from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  getGitHubRuntimeConfiguration,
  requireGitHubRuntimeConfiguration,
} from "../../infrastructure/runtime-integrations.js";

export function getGitHubAppConfigurationMetadata(_workspaceId: string) {
  const configuration = getGitHubRuntimeConfiguration();
  if (!configuration) return Promise.resolve(null);
  return Promise.resolve({
    appId: configuration.appId,
    appSlug: configuration.appSlug,
    source: "environment" as const,
  });
}

export function getGitHubAppConfiguration(_workspaceId: string) {
  const { appId, appSlug, privateKey, webhookSecret } =
    requireGitHubRuntimeConfiguration();
  return Promise.resolve({ appId, appSlug, privateKey, webhookSecret });
}

export async function getGitHubAppConfigurationForInstallation(
  installationId: string,
) {
  const [installation] = await getTowbarDatabase()
    .select({ id: integrationInstallations.id })
    .from(integrationInstallations)
    .where(eq(integrationInstallations.externalId, installationId))
    .limit(1);
  if (!installation) throw notFound("GitHub installation");
  const { appId, appSlug, privateKey, webhookSecret } =
    requireGitHubRuntimeConfiguration();
  return {
    appId,
    appSlug,
    installationRecordId: installation.id,
    privateKey,
    webhookSecret,
  };
}

export async function getGitHubAppConfigurationByAppId(
  appId: string,
  installationId: string,
) {
  const configuration = requireGitHubRuntimeConfiguration();
  if (configuration.appId !== appId) throw notFound("GitHub App configuration");
  const [installation] = await getTowbarDatabase()
    .select({ id: integrationInstallations.id })
    .from(integrationInstallations)
    .where(eq(integrationInstallations.externalId, installationId))
    .limit(1);
  if (!installation) throw notFound("GitHub installation");
  const { appSlug, privateKey, webhookSecret } = configuration;
  return {
    appId,
    appSlug,
    installationRecordId: installation.id,
    privateKey,
    webhookSecret,
  };
}
