import { notFound } from "next/navigation";
import { ServerDetail } from "@/components/server-detail";
import { isServerSectionPath } from "@/lib/server-routes";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  if (!isServerSectionPath(sectionPath)) notFound();
  return <ServerDetail />;
}
