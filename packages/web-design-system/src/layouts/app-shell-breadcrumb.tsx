"use client";

import { useId, useLayoutEffect, useRef } from "react";

import type { AppShellBreadcrumbItems } from "./application-shell-types";
import { useRequiredAppShell } from "./app-shell-boundary";

export function AppShellBreadcrumb({
  items,
  title = items.at(-1)?.label ?? "",
}: {
  items: AppShellBreadcrumbItems;
  title?: string;
}) {
  const id = useId();
  const registrationRef = useRef({ items, title });
  const { registerBreadcrumb, unregisterBreadcrumb } =
    useRequiredAppShell("AppShellBreadcrumb");
  const registrationKey = JSON.stringify({ items, title });

  registrationRef.current = { items, title };

  useLayoutEffect(() => {
    const registration = registrationRef.current;
    registerBreadcrumb(id, registration.items, registration.title);
    return () => unregisterBreadcrumb(id);
  }, [id, registerBreadcrumb, registrationKey, unregisterBreadcrumb]);

  return null;
}
