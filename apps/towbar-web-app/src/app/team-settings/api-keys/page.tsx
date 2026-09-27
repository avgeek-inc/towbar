import { TeamSettings } from "@/components/team-settings";
import { canShowApiMcpSettings } from "@/lib/config";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!canShowApiMcpSettings()) notFound();
  return <TeamSettings page="api-keys" />;
}
