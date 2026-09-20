import { notFound, redirect } from "next/navigation";
import { isLogForwardingRoute } from "@/lib/integration-routes";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (!isLogForwardingRoute(provider)) notFound();
  redirect(`/manage/integrations/${provider}`);
}
