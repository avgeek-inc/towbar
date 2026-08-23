import { PageSection } from "@workspace/web-design-system/layouts/page";
import { StatusPage } from "@workspace/web-page-sections/page";

import { Logout } from "@/components/logout";

export default function Page() {
  return (
    <StatusPage
      breadcrumbAncestors={[{ href: "/", label: "Towbar" }]}
      title="Signing out"
    >
      <PageSection>
        <Logout />
      </PageSection>
    </StatusPage>
  );
}
