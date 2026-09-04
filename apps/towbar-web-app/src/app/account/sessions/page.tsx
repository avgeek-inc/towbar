import { DashboardPage } from "@/components/page-parts";
import { SessionSettings } from "@/components/settings-pages";

export default function Page() {
  return (
    <DashboardPage title="Sessions">
      <SessionSettings />
    </DashboardPage>
  );
}
