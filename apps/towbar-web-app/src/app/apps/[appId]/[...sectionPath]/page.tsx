import { notFound } from "next/navigation";
import { AppDetail } from "@/components/app-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section, child] = sectionPath;
  const children: Record<string, string[]> = {
    settings: ["configuration", "preview", "auto-deploy", "secrets"],
  };
  if (
    !section ||
    ![
      "overview",
      "performance",
      "alerts",
      "incidents",
      "notifications",
      "compare-deployments",
      "deployments",
      "previews",
      "logs",
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
