import { Suspense } from "react";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import { AuthPage } from "@workspace/web-page-sections/page";
import { LoginForm } from "@/components/login-form";
export default function Page() {
  return (
    <AuthPage>
      <Suspense
        fallback={
          <Skeleton
            aria-label="Loading sign in"
            className="h-72 w-full rounded-2xl"
            role="status"
          />
        }
      >
        <LoginForm />
      </Suspense>
    </AuthPage>
  );
}
