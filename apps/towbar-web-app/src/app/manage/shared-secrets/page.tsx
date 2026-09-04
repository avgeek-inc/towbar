import { GlobalSecrets } from "@/components/app-secrets";
import { DashboardPage } from "@/components/page-parts";

export default function Page() {
  return (
    <DashboardPage title="Shared secrets">
      <GlobalSecrets />
    </DashboardPage>
  );
}
