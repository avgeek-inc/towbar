import { notFound } from "next/navigation";
import { DeploymentRouteRedirect } from "@/components/deployment-route-redirect";

export default async function Page({
  params,
}: {
  params: Promise<{ sectionPath: string[] }>;
}) {
  const { sectionPath } = await params;
  const [section] = sectionPath;
  if (
    !section ||
    !["overview", "progress", "logs", "vulnerabilities"].includes(section) ||
    sectionPath.length > 1
  )
    notFound();
  return <DeploymentRouteRedirect section={section} />;
}
