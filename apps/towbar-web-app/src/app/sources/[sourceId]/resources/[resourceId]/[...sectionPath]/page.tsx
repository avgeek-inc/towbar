import { notFound } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section, child] = sectionPath;
  const children: Record<string, string[]> = {
    settings: [
      "configuration",
      "connection",
      "backups",
      "auto-deploy",
      "secrets",
    ],
  };
  if (
    !section ||
    !["overview", "monitoring", "deployments", "logs", "settings"].includes(
      section,
    ) ||
    sectionPath.length > 2 ||
    (child && !children[section]?.includes(child))
  )
    notFound();
  return <ResourceDetail />;
}
