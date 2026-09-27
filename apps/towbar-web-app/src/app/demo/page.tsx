import { notFound } from "next/navigation";
import { DemoWelcome } from "@/components/demo-session";

export default function DemoPage() {
  if (process.env.NEXT_PUBLIC_TOWBAR_PUBLIC_DEMO !== "true") notFound();
  return <DemoWelcome />;
}
