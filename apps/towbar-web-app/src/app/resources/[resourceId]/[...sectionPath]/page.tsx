import { notFound, redirect } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ resourceId: string; sectionPath: string[] }>;
}) {
  const { resourceId, sectionPath } = await params;
  const [section, child] = sectionPath;
  if (section === "notifications" && !child)
    redirect(`/resources/${resourceId}/settings/notifications`);
  if (
    section === "settings" &&
    child &&
    ["backup", "backups", "restore"].includes(child)
  )
    redirect(
      `/resources/${resourceId}/${child === "backups" ? "backup" : child}`,
    );
  const children: Record<string, string[]> = {
    settings: [
      "configuration",
      "connection",
      "auto-deploy",
      "secrets",
      "notifications",
    ],
  };
  if (
    !section ||
    ![
      "overview",
      "performance",
      "alerts",
      "incidents",
      "compare-deployments",
      "deployments",
      "backup",
      "restore",
      "logs",
      "settings",
      "vulnerabilities",
    ].includes(section) ||
    sectionPath.length > 2 ||
    (child && !children[section]?.includes(child))
  )
    notFound();
  return <ResourceDetail />;
}
