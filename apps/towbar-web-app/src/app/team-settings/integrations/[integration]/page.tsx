import { notFound, redirect } from "next/navigation";
import { isIntegrationRoute } from "@/lib/integration-routes";

export default async function Page({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;
  if (!isIntegrationRoute(integration)) notFound();
  redirect(`/manage/integrations/${integration}`);
}
