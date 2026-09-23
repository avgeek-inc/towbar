"use client";

import { createContext, useContext, useEffect } from "react";
import type { Dispatch, SetStateAction, ReactNode } from "react";

export type PageSelection = {
  actions?: ReactNode;
  badge?: ReactNode;
  label: string;
  keepEntityName?: boolean;
  icon?: ReactNode;
};
export const PageSelectionContext = createContext<Dispatch<
  SetStateAction<PageSelection | null>
> | null>(null);

export function PageSelectionTitle({
  actions,
  badge,
  label,
  icon,
  keepEntityName = false,
}: PageSelection) {
  const setSelection = useContext(PageSelectionContext);
  useEffect(() => {
    setSelection?.({ actions, badge, label, keepEntityName, icon });
    return () => setSelection?.(null);
  }, [setSelection, actions, badge, label, keepEntityName, icon]);
  return null;
}
