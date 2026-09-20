import { redirect } from "next/navigation";

const notifications = new Set([
  "slack",
  "email",
  "discord",
  "telegram",
  "webhook",
]);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const requested = (await searchParams).provider;
  redirect(
    `/manage/integrations/${requested && notifications.has(requested) ? requested : "slack"}`,
  );
}
