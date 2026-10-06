import { AuthPage } from "@avgeek-oss/design-system/patterns/pages/page";
import { ConfirmEmailChange } from "@/components/email-settings";
export const metadata = { referrer: "no-referrer" as const };
export default function Page() {
  return (
    <AuthPage>
      <ConfirmEmailChange />
    </AuthPage>
  );
}
