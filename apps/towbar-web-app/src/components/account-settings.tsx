"use client";
import {
  ComputerIcon,
  Key01Icon,
  BookOpen01Icon,
  UserAccountIcon,
  SecurityCheckIcon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardPage } from "./page-parts";
import { useRouter } from "next/navigation";
import { SecondaryItems } from "./secondary-sidebar";
import { ApiMcpSettings } from "./api-mcp-settings";
import { SecuritySettings } from "./security-settings";
import { DateTimePreferencesSettings } from "./date-time-preferences";
import {
  ProfileSettings,
  EmailPasswordSettings,
  SessionSettings,
} from "./settings-pages";
import { hasHttpsExternalAccess } from "@/lib/config";

type AccountSettingsPage =
  | "profile"
  | "preferences"
  | "email-password"
  | "sessions"
  | "2fa"
  | "api-keys"
  | "mcp";

export function AccountSettings({ page }: { page: AccountSettingsPage }) {
  const router = useRouter();
  const accountSettingsGroups: ReadonlyArray<{
    title: string;
    pages: readonly AccountSettingsPage[];
  }> = [
    { title: "Account", pages: ["profile", "preferences"] },
    { title: "Security", pages: ["email-password", "2fa", "sessions"] },
    ...(hasHttpsExternalAccess()
      ? [{ title: "API & MCP", pages: ["api-keys", "mcp"] as const }]
      : []),
  ];
  const titles = {
    profile: "Profile",
    preferences: "Preferences",
    "email-password": "Email & Password",
    sessions: "Sessions",
    "2fa": "Two-factor Auth",
    "api-keys": "API Keys",
    mcp: "MCP Guide",
  };
  const icons = {
    profile: UserAccountIcon,
    preferences: Settings01Icon,
    "email-password": Mail01Icon,
    sessions: ComputerIcon,
    "2fa": SecurityCheckIcon,
    "api-keys": Key01Icon,
    mcp: BookOpen01Icon,
  };
  return (
    <DashboardPage title={titles[page]} icon={icons[page]}>
      {accountSettingsGroups.map((group) => (
        <SecondaryItems
          key={group.title}
          title={group.title}
          selected={page}
          onSelect={(value) => router.push(`/settings/${value}`)}
          items={group.pages.map((id) => ({
            id,
            label: titles[id],
            icon: <HugeiconsIcon icon={icons[id]} />,
          }))}
        />
      ))}
      {page === "profile" ? (
        <ProfileSettings />
      ) : page === "preferences" ? (
        <DateTimePreferencesSettings />
      ) : page === "email-password" ? (
        <EmailPasswordSettings />
      ) : page === "2fa" ? (
        <SecuritySettings />
      ) : page === "sessions" ? (
        <SessionSettings />
      ) : (
        <ApiMcpSettings
          section={page === "api-keys" ? "personal-keys" : page}
        />
      )}
    </DashboardPage>
  );
}
