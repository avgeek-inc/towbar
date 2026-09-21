import { notFound } from "next/navigation";
import { SourceSyncDetail } from "@/components/source-sync-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section] = sectionPath;

  if (
    !section ||
    !["overview", "changes", "issues"].includes(section) ||
    sectionPath.length > 1
  ) {
    notFound();
  }

  return <SourceSyncDetail />;
}
