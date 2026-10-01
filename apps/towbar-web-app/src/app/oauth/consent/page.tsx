import { Suspense } from "react";
import { AuthPage } from "@workspace/web-page-sections/page";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { McpOAuthConsent } from "@/components/mcp-oauth-consent";

export default function Page() {
  return (
    <AuthPage>
      <Suspense fallback={<QueryLoading />}>
        <McpOAuthConsent />
      </Suspense>
    </AuthPage>
  );
}
