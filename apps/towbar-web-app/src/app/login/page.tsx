import { Suspense } from "react";

import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { AuthPage } from "@workspace/web-page-sections/page";

import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <AuthPage>
      <Suspense fallback={<QueryLoading />}>
        <LoginForm />
      </Suspense>
    </AuthPage>
  );
}
