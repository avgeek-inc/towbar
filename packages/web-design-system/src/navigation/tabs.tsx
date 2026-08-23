"use client";

import {
  Tab as HeroTab,
  TabIndicator as HeroTabIndicator,
  TabList as HeroTabList,
  TabListContainer as HeroTabListContainer,
  TabPanel as HeroTabPanel,
  TabSeparator as HeroTabSeparator,
  TabsRoot as HeroTabsRoot,
  tabsVariants,
  type TabListContainerProps,
  type TabProps,
  type TabsRootProps,
} from "@heroui/react";
import { createContext, use } from "react";

import { cn } from "../lib/utils";

type TabsOrientation = NonNullable<TabsRootProps["orientation"]>;

const TabsOrientationContext = createContext<TabsOrientation>("horizontal");

function TabsRoot({ orientation = "horizontal", ...props }: TabsRootProps) {
  return (
    <TabsOrientationContext.Provider value={orientation}>
      <HeroTabsRoot orientation={orientation} {...props} />
    </TabsOrientationContext.Provider>
  );
}

function TabsTab({ className, ...props }: TabProps) {
  const orientation = use(TabsOrientationContext);

  return (
    <HeroTab
      className={cn(
        orientation === "vertical" &&
          "justify-start gap-2 text-start [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsListContainer({ className, ...props }: TabListContainerProps) {
  const orientation = use(TabsOrientationContext);

  return (
    <HeroTabListContainer
      className={cn(orientation === "vertical" && "self-start", className)}
      {...props}
    />
  );
}

const Tabs = Object.assign(TabsRoot, {
  Root: TabsRoot,
  ListContainer: TabsListContainer,
  List: HeroTabList,
  Tab: TabsTab,
  Indicator: HeroTabIndicator,
  Separator: HeroTabSeparator,
  Panel: HeroTabPanel,
});

export { Tabs, tabsVariants };
export type {
  TabIndicatorProps,
  TabListContainerProps,
  TabListProps,
  TabPanelProps,
  TabProps,
  TabSeparatorProps,
  TabsProps,
  TabsRootProps,
  TabsVariants,
} from "@heroui/react";
