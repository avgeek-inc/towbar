import { notFound, redirect } from "next/navigation";

const notifications = [
  "slack",
  "email",
  "discord",
  "telegram",
  "webhook",
  "deliveries",
];

export default async function Page({
  params,
}: {
  params: Promise<{ notification: string }>;
}) {
  const { notification } = await params;
  if (!notifications.includes(notification)) notFound();
  redirect(`/manage/integrations/${notification}`);
}
