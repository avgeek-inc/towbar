import { Suspense } from "react";

import { Spinner } from "@workspace/web-design-system/feedback/spinner";
import { PageSection } from "@workspace/web-design-system/layouts/page";
import { StatusPage } from "@workspace/web-page-sections/page";

import { AuthCallback } from "@/components/auth-callback";

export default function Page() {
  return (
    <StatusPage
      breadcrumbAncestors={[{ href: "/", label: "Towbar" }]}
      title="Completing sign-in"
    >
      <PageSection>
        <Suspense
          fallback={
            <div className="grid place-items-center py-12">
              <Spinner aria-label="Completing sign in" />
            </div>
          }
        >
          <AuthCallback />
        </Suspense>
      </PageSection>
    </StatusPage>
  );
}
