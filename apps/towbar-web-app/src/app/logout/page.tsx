import { PageSection } from "@avgeek-oss/design-system/layouts/page";
import { StatusPage } from "@avgeek-oss/design-system/patterns/pages/page";

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
