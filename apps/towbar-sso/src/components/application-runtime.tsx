"use client";

import type { ReactNode } from "react";

import { AppLayout } from "@workspace/web-design-system/navigation/app-layout";
import {
  AppShell,
  ApplicationFooter,
  ApplicationNavbar,
} from "@workspace/web-design-system/layouts/app-shell";

import {
  applicationFooter,
  applicationHeader,
  applicationPolicy,
} from "@/lib/application-layout";

export function ApplicationRuntime({ children }: { children: ReactNode }) {
  return (
    <AppShell contentWidth="compact" policy={applicationPolicy}>
      <AppLayout
        footer={
          <ApplicationFooter
            config={applicationFooter}
            policy={applicationPolicy}
          />
        }
        navbar={
          <ApplicationNavbar
            config={applicationHeader}
            showThemeSwitcher={applicationPolicy.themeControl === "header"}
          />
        }
        scrollMode="page"
        toggleShortcut={false}
      >
        <AppShell.Content>{children}</AppShell.Content>
      </AppLayout>
    </AppShell>
  );
}
