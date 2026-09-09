"use client";
import {
  ComputerIcon,
  Settings01Icon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardPage } from "./page-parts";
import { ResponsiveSubtabs } from "./responsive-subtabs";
import { ProfileSettings, SessionSettings } from "./settings-pages";

export function AccountSettings() {
  return (
    <DashboardPage title="Settings" icon={Settings01Icon}>
      <ResponsiveSubtabs
        ariaLabel="Account settings"
        defaultSelectedKey="profile"
        tabs={[
          {
            value: "profile",
            label: "Profile",
            icon: <HugeiconsIcon icon={UserAccountIcon} />,
            content: <ProfileSettings />,
          },
          {
            value: "sessions",
            label: "Sessions",
            icon: <HugeiconsIcon icon={ComputerIcon} />,
            content: <SessionSettings />,
          },
        ]}
      />
    </DashboardPage>
  );
}
