import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string; sectionPath: string[] }>;
}) {
  const { appId, sectionPath } = await params;
  redirect(`/services/${appId}/${sectionPath.join("/")}`);
}
