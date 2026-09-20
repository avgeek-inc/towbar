"use client";

import { Rocket01Icon } from "@hugeicons/core-free-icons";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Deployment } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { deploymentHref } from "@/lib/deployment-route";
import { DashboardPage } from "./page-parts";

export function DeploymentRouteRedirect({ section }: { section?: string }) {
  const { deploymentId } = useParams<{ deploymentId: string }>();
  const router = useRouter();
  const query = useApiQuery<{ deployment: Deployment }>(
    `/v1/core/deployments/${deploymentId}`,
  );

  useEffect(() => {
    if (!query.data) return;
    router.replace(deploymentHref(query.data.deployment, section));
  }, [query.data, router, section]);

  return (
    <DashboardPage icon={Rocket01Icon} title="Deployment">
      {query.error ? <QueryError message={query.error} /> : <QueryLoading />}
    </DashboardPage>
  );
}
