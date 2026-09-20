import { redirect } from "next/navigation";

import { isIntegrationRoute } from "@/lib/integration-routes";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ integration?: string }>;
}) {
  const requested = (await searchParams).integration;
  redirect(
    `/manage/integrations/${isIntegrationRoute(requested) ? requested : "github"}`,
  );
}
