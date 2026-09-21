import { notFound, redirect } from "next/navigation";
import { hasHttpsExternalAccess } from "@/lib/config";
const destinations: Record<string, string> = {
  "private-keys": "/team-settings/ssh-keys",
  "personal-keys": "/settings/api-keys",
  "team-keys": "/team-settings/api-keys",
  mcp: "/settings/mcp",
};
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const target = destinations[section];
  if (!target) notFound();
  if (!hasHttpsExternalAccess && section !== "private-keys") notFound();
  redirect(target);
}
