import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { DashboardPage, serversBreadcrumb } from "@/components/page-parts";
import { ServerEditor } from "@/components/server-editor";

export default function Page() {
  return (
    <DashboardPage
      icon={ServerStack01Icon}
      breadcrumbAncestors={serversBreadcrumb}
      title="Add server"
    >
      <ServerEditor />
    </DashboardPage>
  );
}
