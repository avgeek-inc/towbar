import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const { resourceId } = await params;
  redirect(`/datastores/${resourceId}`);
}
