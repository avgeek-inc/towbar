import { AccountSettings } from "@/components/account-settings";
import { canShowApiMcpSettings } from "@/lib/config";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!canShowApiMcpSettings()) notFound();
  return <AccountSettings page="mcp" />;
}
