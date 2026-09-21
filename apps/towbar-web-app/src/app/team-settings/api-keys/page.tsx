import { TeamSettings } from "@/components/team-settings";
import { hasHttpsExternalAccess } from "@/lib/config";
import { notFound } from "next/navigation";
export default function Page() {
  if (!hasHttpsExternalAccess) notFound();
  return <TeamSettings page="api-keys" />;
}
