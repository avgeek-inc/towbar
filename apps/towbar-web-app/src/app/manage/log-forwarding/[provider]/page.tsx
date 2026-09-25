import { FileViewIcon } from "@hugeicons/core-free-icons";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { LogForwardingSettings } from "@/components/log-forwarding-settings";
import { DashboardPage } from "@/components/page-parts";
import { isLogForwardingRoute } from "@/lib/integration-routes";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (!isLogForwardingRoute(provider)) notFound();
  return (
    <DashboardPage title="Log forwarding" icon={FileViewIcon}>
      <Suspense fallback={<QueryLoading />}>
        <LogForwardingSettings provider={provider} />
      </Suspense>
    </DashboardPage>
  );
}
