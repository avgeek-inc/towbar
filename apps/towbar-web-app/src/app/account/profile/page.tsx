import { UserAccountIcon } from "@hugeicons/core-free-icons";
import { DashboardPage } from "@/components/page-parts";
import { ProfileSettings } from "@/components/settings-pages";

export default function Page() {
  return (
    <DashboardPage icon={UserAccountIcon} title="Profile">
      <ProfileSettings />
    </DashboardPage>
  );
}
