import { DashboardPage } from "@/components/page-parts";
import { ProfileSettings } from "@/components/settings-pages";

export default function Page() {
  return (
    <DashboardPage title="Profile">
      <ProfileSettings />
    </DashboardPage>
  );
}
