import { SourceCodeIcon } from "@hugeicons/core-free-icons";
import { ApiMcpSettings } from "@/components/api-mcp-settings";
import { DashboardPage } from "@/components/page-parts";
export default function Page() {
  return (
    <DashboardPage icon={SourceCodeIcon} title="API & MCP">
      <ApiMcpSettings />
    </DashboardPage>
  );
}
