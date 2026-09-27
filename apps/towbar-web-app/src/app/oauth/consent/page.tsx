import { Suspense } from "react";
import { AuthPage } from "@workspace/web-page-sections/page";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import { McpOAuthConsent } from "@/components/mcp-oauth-consent";

export default function Page() {
  return (
    <AuthPage>
      <Suspense
        fallback={
          <Skeleton
            aria-label="Loading authorization"
            className="h-72 w-full rounded-2xl"
            role="status"
          />
        }
      >
        <McpOAuthConsent />
      </Suspense>
    </AuthPage>
  );
}
