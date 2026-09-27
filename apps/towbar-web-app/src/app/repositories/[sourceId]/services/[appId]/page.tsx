import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  redirect(`/services/${appId}`);
}
