import { redirect } from "next/navigation";

import {
  isIntegrationRoute,
  isLogForwardingRoute,
} from "@/lib/integration-routes";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ integration?: string }>;
}) {
  const requested = (await searchParams).integration;
  if (
    requested &&
    ["slack", "email", "discord", "telegram", "webhook", "deliveries"].includes(
      requested,
    )
  )
    redirect(`/manage/notifications/${requested}`);
  if (isLogForwardingRoute(requested))
    redirect(`/manage/log-forwarding/${requested}`);
  redirect(
    `/manage/integrations/${isIntegrationRoute(requested) ? requested : "github"}`,
  );
}
