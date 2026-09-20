import { Suspense } from "react";
import { AuthPage } from "@workspace/web-page-sections/page";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ForgotPasswordForm } from "@/components/public-auth-flows";
export const metadata = { referrer: "no-referrer" as const };
export default function Page() {
  return (
    <AuthPage>
      <Suspense fallback={<QueryLoading />}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthPage>
  );
}

export const dynamic = "force-dynamic";
