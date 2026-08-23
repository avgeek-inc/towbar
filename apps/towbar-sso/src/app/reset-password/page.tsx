import { Suspense } from "react";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import { AuthPage } from "@workspace/web-page-sections/page";
import { ResetPasswordForm } from "@/components/recovery-forms";
export default function Page() {
  return (
    <AuthPage>
      <Suspense
        fallback={
          <Skeleton
            aria-label="Loading password reset"
            className="h-72 w-full rounded-2xl"
            role="status"
          />
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthPage>
  );
}
