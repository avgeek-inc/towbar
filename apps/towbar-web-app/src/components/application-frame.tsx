"use client";
import { groupDeployableInstances } from "@/lib/deployable-groups";
import { ReauthenticationDialog } from "./reauthentication-dialog";
import { AccessContext, routePermission } from "./access-context";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Button } from "@workspace/web-design-system/buttons/button";
import { ThemeSwitcher } from "@workspace/web-design-system/controls/theme-switcher";
import { AlertDialog } from "@workspace/web-design-system/overlays/alert-dialog";
import { clearApiQueryCache, refreshApiQueries } from "@/hooks/use-api-query";
import { SecondarySidebarLayout } from "./secondary-sidebar";

import { useCallback, useEffect, useRef, useState } from "react";
import { Logout03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { Toast } from "@workspace/web-design-system/overlays/toast";

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
import { HeadingHelpContext } from "@workspace/web-design-system/overlays/heading-help";
import { headingDocumentation } from "@/lib/documentation";

export function ApplicationFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const [user, setUser] = useState<TowbarUser | null>();
  const apps = useApiQuery<{ apps: App[] }>(
    user && !user.mustChangePassword ? "/v1/core/apps" : null,
    30_000,
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    user && !user.mustChangePassword ? "/v1/core/resources" : null,
    30_000,
  );
  const servers = useApiQuery<{ servers: Server[] }>(
    user && !user.mustChangePassword ? "/v1/core/servers" : null,
    30_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>(
    user && !user.mustChangePassword ? "/v1/core/sources" : null,
    30_000,
  );
  const monitoring = useApiQuery<{
    activeIncidents: number;
    criticalVulnerabilities: number;
  }>(
    user && !user.mustChangePassword ? "/v1/core/monitoring/summary" : null,
    30_000,
  );
  const sidebarState = usePersistentAppSidebar("towbar-sidebar");
  const isLogin = pathname === "/login" || pathname === "/setup";
  const isPublicAuth =
    isLogin ||
    pathname.startsWith("/invite/") ||
    [
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/confirm-email-change",
      "/first-password",
    ].includes(pathname);
  const userRef = useRef(user);
  userRef.current = user;
  const isSessionTransition = pathname === "/logout";
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "towbar:preferences-revision") refreshApiQueries();
    };
    window.addEventListener("towbar:preferences-changed", refreshApiQueries);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(
        "towbar:preferences-changed",
        refreshApiQueries,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    if (isSessionTransition) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        // Public auth state also supports verified invitees who do not have a membership yet.
        const response = await api.get<{ user: TowbarUser | null }>(
          "/v1/public/auth/state",
        );
        if (!active) return;
        if (JSON.stringify(userRef.current) !== JSON.stringify(response.user)) {
          clearApiQueryCache();
          userRef.current = response.user;
          setUser(response.user);
        }
      } catch {
        if (active) {
          clearApiQueryCache();
          setUser(null);
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("towbar:access-error", refresh);
    window.addEventListener("towbar:identity-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("towbar:access-error", refresh);
      window.removeEventListener("towbar:identity-changed", refresh);
    };
  }, [isSessionTransition, pathname]);
  useEffect(() => {
    if (isSessionTransition || user === undefined) return;
    if (user?.mustChangePassword && pathname !== "/first-password") {
      router.replace("/first-password");
      return;
    }
    if (isLogin && user) {
      router.replace("/");
      return;
    }
    if (!isPublicAuth && user === null)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLogin, isPublicAuth, isSessionTransition, pathname, router, user]);

  if (isSessionTransition) return children;
  if (isPublicAuth)
    return (
      <AccessContext.Provider value={user ?? null}>
        {children}
        <Toast.Provider />
      </AccessContext.Provider>
    );
  if (!user || user.mustChangePassword) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Spinner aria-label="Loading Towbar" />
      </div>
    );
  }
  const sidebar = createApplicationSidebar(
    {
      apps: apps.data
        ? groupDeployableInstances(apps.data.apps).length
        : undefined,
      resources: resources.data
        ? groupDeployableInstances(resources.data.resources).length
        : undefined,
      servers: servers.data?.servers.length,
      sources: sources.data?.sources.length,
    },
    monitoring.error ? undefined : monitoring.data,
    user,
  );
  return (
    <AccessContext.Provider value={user}>
      <HeadingHelpContext.Provider
        value={(title, kind) => headingDocumentation(pathname, title, kind)}
      >
        <AppShell contentWidth="full" policy={applicationPolicy}>
          <AppLayout
            navigate={navigate}
            navbar={
              <ApplicationNavbar
                actions={
                  <div className="flex items-center gap-2">
                    <DeploymentQueue inline />
                    <NotificationCenter />
                    <div className="flex items-center gap-1">
                      <ThemeSwitcher size="small" />
                      <HeaderSignOut onSignOut={() => router.push("/logout")} />
                    </div>
                  </div>
                }
                config={applicationHeader}
                hasSidebar
                sidebarOpen={sidebarState.sidebarOpen}
                onSidebarToggle={() =>
                  sidebarState.onSidebarOpenChange(!sidebarState.sidebarOpen)
                }
              />
            }
            scrollMode="page"
            sidebar={<ApplicationSidebar config={sidebar} />}
            sidebarCollapsible="icon"
            toggleShortcut
            {...sidebarState}
          >
            <SecondarySidebarLayout>
              <AppShell.Content
                className="pt-0 pb-20 sm:pt-0 sm:pb-24"
                variant="broad"
              >
                <RelativeTimeProvider>
                  {routePermission(pathname) &&
                  !user.capabilities?.includes(routePermission(pathname)!) ? (
                    <EmptyState>
                      <EmptyState.Header>
                        <EmptyState.Title>Access restricted</EmptyState.Title>
                        <EmptyState.Description>
                          Your current role does not have access to this page.
                          Contact a team admin if you need access.
                        </EmptyState.Description>
                      </EmptyState.Header>
                      <EmptyState.Content>
                        <Button onPress={() => navigate("/")}>
                          Back to overview
                        </Button>
                      </EmptyState.Content>
                    </EmptyState>
                  ) : (
                    children
                  )}
                </RelativeTimeProvider>
              </AppShell.Content>
            </SecondarySidebarLayout>
          </AppLayout>
        </AppShell>
        <ReauthenticationDialog />
      </HeadingHelpContext.Provider>
    </AccessContext.Provider>
  );
}

function HeaderSignOut({ onSignOut }: { onSignOut: () => void }) {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <>
      <Button
        aria-label="Sign out"
        className="size-8 min-h-8 min-w-8 rounded-full p-0"
        isIconOnly
        onPress={() => setIsConfirming(true)}
        variant="danger"
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4"
          icon={Logout03Icon}
        />
      </Button>
      <AlertDialog.Backdrop
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>Sign out of Towbar?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              This ends the current Towbar session on this browser. To manage
              other sessions, check your personal settings.
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                onPress={() => setIsConfirming(false)}
                variant="secondary"
              >
                Stay signed in
              </Button>
              <Button
                onPress={() => {
                  setIsConfirming(false);
                  onSignOut();
                }}
                variant="danger"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-4"
                  icon={Logout03Icon}
                />
                Sign out
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
