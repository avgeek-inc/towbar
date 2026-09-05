"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type {
  App,
  Resource,
  Server,
  Source,
  TowbarUser,
} from "@workspace/towbar-web-client";
import { AppLayout } from "@workspace/web-design-system/navigation/app-layout";
import {
  AppShell,
  ApplicationNavbar,
  ApplicationSidebar,
  usePersistentAppSidebar,
} from "@workspace/web-design-system/layouts/app-shell";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";

import { api } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  applicationHeader,
  applicationPolicy,
  createApplicationSidebar,
} from "@/lib/application-layout";
import { RelativeTimeProvider } from "./last-synced-time";
import { DeploymentQueue } from "@/components/deployment-queue";
import { NotificationCenter } from "@/components/notification-center";

export function ApplicationFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const [user, setUser] = useState<TowbarUser | null>();
  const apps = useApiQuery<{ apps: App[] }>(
    user ? "/v1/core/apps" : null,
    30_000,
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    user ? "/v1/core/resources" : null,
    30_000,
  );
  const servers = useApiQuery<{ servers: Server[] }>(
    user ? "/v1/core/servers" : null,
    30_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>(
    user ? "/v1/core/sources" : null,
    30_000,
  );
  const sidebarState = usePersistentAppSidebar("towbar-sidebar");
  const isLogin = pathname === "/login";
  const isSessionTransition = pathname === "/logout";
  useEffect(() => {
    if (isSessionTransition) return;
    let active = true;
    api
      .get<{ user: TowbarUser }>("/v1/core/session")
      .then((response) => active && setUser(response.user))
      .catch(() => active && setUser(null));
    return () => {
      active = false;
    };
  }, [isSessionTransition]);
  useEffect(() => {
    if (isSessionTransition || user === undefined) return;
    if (isLogin && user) {
      router.replace("/");
      return;
    }
    if (!isLogin && user === null) {
      const next =
        pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      router.replace(`/login${next}`);
    }
  }, [isLogin, isSessionTransition, pathname, router, user]);

  if (isSessionTransition) return children;
  if (isLogin && user === null) return children;
  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Spinner aria-label="Loading Towbar" />
      </div>
    );
  }
  const sidebar = createApplicationSidebar(() => router.push("/logout"), {
    apps: apps.data?.apps.length,
    resources: resources.data?.resources.length,
    servers: servers.data?.servers.length,
    sources: sources.data?.sources.length,
  });
  return (
    <AppShell contentWidth="full" policy={applicationPolicy}>
      <AppLayout
        navigate={navigate}
        navbar={
          <ApplicationNavbar
            actions={<NotificationCenter />}
            config={applicationHeader}
            hasSidebar
            onSidebarToggle={() =>
              sidebarState.onSidebarOpenChange(!sidebarState.sidebarOpen)
            }
            showThemeSwitcher={applicationPolicy.themeControl === "header"}
          />
        }
        scrollMode="page"
        sidebar={<ApplicationSidebar config={sidebar} />}
        sidebarCollapsible="icon"
        toggleShortcut
        {...sidebarState}
      >
        <AppShell.Content
          className="pt-0 pb-20 sm:pt-0 sm:pb-24"
          variant="broad"
        >
          <RelativeTimeProvider>{children}</RelativeTimeProvider>
        </AppShell.Content>
        <DeploymentQueue />
      </AppLayout>
    </AppShell>
  );
}
