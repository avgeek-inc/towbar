import { Suspense } from "react";

import { QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { Integrations } from "@/components/integrations";
import { DashboardPage } from "@/components/page-parts";

export default function Page() {
  return (
    <DashboardPage title="Integrations">
      <Suspense fallback={<QueryLoading />}>
        <Integrations />
      </Suspense>
    </DashboardPage>
  );
}
