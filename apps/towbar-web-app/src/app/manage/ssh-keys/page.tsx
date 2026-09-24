import { ComputerTerminal01Icon } from "@hugeicons/core-free-icons";

import { ApiMcpSettings } from "@/components/api-mcp-settings";
import { DashboardPage } from "@/components/page-parts";

export default function Page() {
  return (
    <DashboardPage title="SSH keys" icon={ComputerTerminal01Icon}>
      <ApiMcpSettings section="private-keys" />
    </DashboardPage>
  );
}
