import { Key01Icon } from "@hugeicons/core-free-icons";

import { GlobalSecrets } from "@/components/app-secrets";
import { DashboardPage } from "@/components/page-parts";

export default function Page() {
  return (
    <DashboardPage title="Shared Secrets" icon={Key01Icon}>
      <GlobalSecrets />
    </DashboardPage>
  );
}
