import { AccountSettings } from "@/components/account-settings";
import { hasHttpsExternalAccess } from "@/lib/config";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!hasHttpsExternalAccess()) notFound();
  return <AccountSettings page="mcp" />;
}
