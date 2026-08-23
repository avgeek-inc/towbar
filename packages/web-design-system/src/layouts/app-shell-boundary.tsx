"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AppShellBreadcrumbItems } from "./application-shell-types";

type BreadcrumbRegistration = {
  items: AppShellBreadcrumbItems;
  title: string;
};

type AppShellBoundaryContextValue = {
  breadcrumbItems: AppShellBreadcrumbItems | null;
  pageTitle: string | null;
  registerBreadcrumb: (
    id: string,
    items: AppShellBreadcrumbItems,
    title: string,
  ) => void;
  unregisterBreadcrumb: (id: string) => void;
};

const AppShellBoundaryContext =
  createContext<AppShellBoundaryContextValue | null>(null);

export function AppShellBoundary({ children }: { children: ReactNode }) {
  const registrations = useRef(new Map<string, BreadcrumbRegistration>());
  const [breadcrumbItems, setBreadcrumbItems] =
    useState<AppShellBreadcrumbItems | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  const registerBreadcrumb = useCallback(
    (id: string, items: AppShellBreadcrumbItems, title: string) => {
      registrations.current.delete(id);
      registrations.current.set(id, { items, title });
      setBreadcrumbItems(items);
      setPageTitle(title);
    },
    [],
  );
  const unregisterBreadcrumb = useCallback((id: string) => {
    registrations.current.delete(id);
    const activeRegistration = Array.from(registrations.current.values()).at(
      -1,
    );
    setBreadcrumbItems(activeRegistration?.items ?? null);
    setPageTitle(activeRegistration?.title ?? null);
  }, []);
  const value = useMemo(
    () => ({
      breadcrumbItems,
      pageTitle,
      registerBreadcrumb,
      unregisterBreadcrumb,
    }),
    [breadcrumbItems, pageTitle, registerBreadcrumb, unregisterBreadcrumb],
  );

  return (
    <AppShellBoundaryContext.Provider value={value}>
      {children}
    </AppShellBoundaryContext.Provider>
  );
}

export function useRequiredAppShell(owner: string) {
  const context = useContext(AppShellBoundaryContext);
  if (!context) {
    throw new Error(`${owner} must be rendered inside AppShell`);
  }
  return context;
}

export function useAppShellHeaderState() {
  const { breadcrumbItems, pageTitle } =
    useRequiredAppShell("ApplicationNavbar");
  return { breadcrumbItems, pageTitle };
}
