import { notFound } from "next/navigation";
import { DeploymentDetail } from "@/components/deployment-detail";

const sections = ["overview", "progress", "logs", "vulnerabilities"];

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section] = sectionPath;
  if (!section || !sections.includes(section) || sectionPath.length > 1)
    notFound();
  return <DeploymentDetail />;
}
