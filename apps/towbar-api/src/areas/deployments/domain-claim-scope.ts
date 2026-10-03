import { deploymentPublicHostnames } from "@workspace/towbar-core";
import type { NormalizedDeployable } from "@workspace/towbar-core";
import type { apps, domainClaims } from "@workspace/towbar-database/schema";

export type DomainClaimScope =
  { sourceEnvironmentId: string } | { appId: string; hostnames: string[] };

export function reconciliationHostnames(input: {
  instances: Array<typeof apps.$inferSelect>;
  previous: Array<typeof domainClaims.$inferSelect>;
  retained: Array<{ appId: string; app: NormalizedDeployable }>;
  scope?: DomainClaimScope;
}) {
  const { instances, previous, retained, scope } = input;
  const selected = instances.filter(
    (app) =>
      !scope ||
      ("appId" in scope
        ? app.id === scope.appId
        : app.sourceEnvironmentId === scope.sourceEnvironmentId),
  );
  const appIds = new Set(selected.map((app) => app.id));
  const claims = previous.filter(
    (claim) =>
      !scope ||
      ("appId" in scope
        ? [claim.desiredAppId, claim.activeAppId, claim.releasedAppId].includes(
            scope.appId,
          )
        : claim.sourceEnvironmentId === scope.sourceEnvironmentId),
  );
  return new Set([
    ...(scope && "hostnames" in scope ? scope.hostnames : []),
    ...selected.flatMap((app) => deploymentPublicHostnames(app.config)),
    ...claims.map((claim) => claim.hostname),
    ...retained
      .filter((release) => !scope || appIds.has(release.appId))
      .flatMap((release) => deploymentPublicHostnames(release.app)),
  ]);
}
