import { notFound } from "next/navigation";
import { ServerDetail } from "@/components/server-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section, child] = sectionPath;
  const children: Record<string, string[]> = {
    settings: ["configuration", "host-keys", "monitoring", "cleanup"],
  };
  if (
    !section ||
    ![
      "overview",
      "monitoring",
      "apps",
      "resources",
      "checks",
      "settings",
    ].includes(section) ||
    sectionPath.length > 2 ||
    (child && !children[section]?.includes(child))
  )
    notFound();
  return <ServerDetail />;
}
