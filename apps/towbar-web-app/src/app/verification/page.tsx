import { AuthPage } from "@avgeek-oss/design-system/patterns/pages/page";
import { VerificationEmailForm } from "@/components/public-auth-flows";
export const metadata = { referrer: "no-referrer" as const };
export default function Page() {
  return (
    <AuthPage>
      <VerificationEmailForm />
    </AuthPage>
  );
}
export const dynamic = "force-dynamic";
