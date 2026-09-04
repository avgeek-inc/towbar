import { DashboardPage, serversBreadcrumb } from "@/components/page-parts";
import { ServerEditor } from "@/components/server-editor";

export default function Page() {
  return (
    <DashboardPage breadcrumbAncestors={serversBreadcrumb} title="Add server">
      <ServerEditor />
    </DashboardPage>
  );
}
