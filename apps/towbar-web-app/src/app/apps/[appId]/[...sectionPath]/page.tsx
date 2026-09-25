import { notFound, redirect } from "next/navigation";
import { AppDetail } from "@/components/app-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string; sectionPath: string[] }>;
}) {
  const { appId, sectionPath } = await params;
  const [section, child] = sectionPath;
  if (section === "notifications" && !child)
    redirect(`/apps/${appId}/settings/notifications`);
  const children: Record<string, string[]> = {
    settings: [
      "configuration",
      "preview",
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
      "previews",
      "logs",
      "log-forwarding",
      "storage",
      "jobs",
      "settings",
      "vulnerabilities",
    ].includes(section) ||
    sectionPath.length > 2 ||
    (child && !children[section]?.includes(child))
  )
    notFound();
  return <AppDetail />;
}
