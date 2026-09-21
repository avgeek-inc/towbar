import { redirect } from "next/navigation";

import { isLogForwardingRoute } from "@/lib/integration-routes";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const requested = (await searchParams).provider;
  redirect(
    `/manage/integrations/${isLogForwardingRoute(requested) ? requested : "newrelic"}`,
  );
}
