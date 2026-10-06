import { AuthPage } from "@avgeek-oss/design-system/patterns/pages/page";
import { InvitationForm } from "@/components/public-auth-flows";
export const metadata = { referrer: "no-referrer" as const };
export default async function Page({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  return (
    <AuthPage>
      <InvitationForm invitationId={invitationId} />
    </AuthPage>
  );
}

export const dynamic = "force-dynamic";
