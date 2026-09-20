import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ resourceId: string; sectionPath: string[] }>;
}) {
  const { resourceId, sectionPath } = await params;
  redirect(`/resources/${resourceId}/${sectionPath.join("/")}`);
}
