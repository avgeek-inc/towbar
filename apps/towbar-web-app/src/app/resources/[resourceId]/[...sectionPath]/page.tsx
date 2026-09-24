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
  const children: Record<string, string[]> = {
    settings: [
      "configuration",
      "connection",
      "backup",
      "backups",
      "restore",
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
