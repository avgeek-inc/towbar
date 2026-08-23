"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { TowbarUser } from "@workspace/towbar-web-client";
import { AppLayout } from "@workspace/web-design-system/navigation/app-layout";
import {
  AppShell,
  ApplicationNavbar,
  ApplicationSidebar,
  usePersistentAppSidebar,
} from "@workspace/web-design-system/layouts/app-shell";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";

import { api } from "@/lib/api";
import {
  applicationHeader,
  applicationPolicy,
  createApplicationSidebar,
} from "@/lib/application-layout";
import { DeploymentQueue } from "@/components/deployment-queue";

export function ApplicationFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const [user, setUser] = useState<TowbarUser | null>();
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
  const sidebar = createApplicationSidebar(() => router.push("/logout"));
  return (
    <AppShell contentWidth="full" policy={applicationPolicy}>
      <AppLayout
        navigate={navigate}
        navbar={
          <ApplicationNavbar
            config={applicationHeader}
            hasSidebar
            showThemeSwitcher={applicationPolicy.themeControl === "header"}
          />
        }
        scrollMode="page"
        sidebar={<ApplicationSidebar config={sidebar} />}
        sidebarCollapsible="icon"
        {...sidebarState}
      >
        <AppShell.Content variant="broad">{children}</AppShell.Content>
        <DeploymentQueue />
      </AppLayout>
    </AppShell>
  );
}
