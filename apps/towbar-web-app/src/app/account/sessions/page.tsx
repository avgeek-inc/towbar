import { ComputerIcon } from "@hugeicons/core-free-icons";
import { DashboardPage } from "@/components/page-parts";
import { SessionSettings } from "@/components/settings-pages";

export default function Page() {
  return (
    <DashboardPage icon={ComputerIcon} title="Sessions">
      <SessionSettings />
    </DashboardPage>
  );
}
