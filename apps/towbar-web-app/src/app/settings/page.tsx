import { Suspense } from "react";

import { QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { GitHubSettings } from "@/components/github-settings";
import { DashboardPage } from "@/components/page-parts";
import { SettingsPage } from "@/components/settings-layout";
import { AccountSettings, SessionSettings } from "@/components/settings-pages";

export default function Page() {
  return (
    <Suspense
      fallback={
        <DashboardPage title="Settings">
          <QueryLoading />
        </DashboardPage>
      }
    >
      <SettingsPage
        account={<AccountSettings />}
        github={<GitHubSettings />}
        security={<SessionSettings />}
      />
    </Suspense>
  );
}
