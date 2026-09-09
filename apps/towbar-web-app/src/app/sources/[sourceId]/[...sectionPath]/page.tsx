import { notFound } from "next/navigation";
import { SourceDetail } from "@/components/source-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section, child] = sectionPath;
  const children: Record<string, string[]> = {
    info: ["manifest", "sync-history"],
    settings: ["auto-deploy", "notifications", "secrets", "danger"],
  };
  if (
    !section ||
    !["apps", "resources", "info", "settings"].includes(section) ||
    sectionPath.length > 2 ||
    (child && !children[section]?.includes(child))
  )
    notFound();
  return <SourceDetail />;
}
