import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ settings?: string }>;
}) {
  const { settings } = await searchParams;
  redirect(
    settings === "sessions" ? "/settings/sessions" : "/settings/profile",
  );
}
