"use client";
import { ComputerIcon, UserAccountIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardPage } from "./page-parts";
import { useRouter } from "next/navigation";
import { SecondaryItems } from "./secondary-sidebar";
import { ProfileSettings, SessionSettings } from "./settings-pages";

export function AccountSettings({ page }: { page: "profile" | "sessions" }) {
  const router = useRouter();
  return (
    <DashboardPage
      title={page === "profile" ? "Profile" : "Sessions"}
      icon={page === "profile" ? UserAccountIcon : ComputerIcon}
    >
      <SecondaryItems
        title="Account settings"
        selected={page}
        onSelect={(value) => router.push(`/settings/${value}`)}
        items={[
          {
            id: "profile",
            label: "Profile",
            icon: <HugeiconsIcon icon={UserAccountIcon} />,
          },
          {
            id: "sessions",
            label: "Sessions",
            icon: <HugeiconsIcon icon={ComputerIcon} />,
          },
        ]}
      />
      {page === "profile" ? <ProfileSettings /> : <SessionSettings />}
    </DashboardPage>
  );
}
