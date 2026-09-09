"use client";

import { createContext, useContext, useEffect } from "react";
import type { Dispatch, SetStateAction, ReactNode } from "react";

export type PageSelection = {
  label: string;
  keepEntityName?: boolean;
  icon?: ReactNode;
};
export const PageSelectionContext = createContext<Dispatch<
  SetStateAction<PageSelection | null>
> | null>(null);

export function PageSelectionTitle({
  label,
  icon,
  keepEntityName = false,
}: PageSelection) {
  const setSelection = useContext(PageSelectionContext);
  useEffect(() => {
    setSelection?.({ label, keepEntityName, icon });
    return () => setSelection?.(null);
  }, [setSelection, label, keepEntityName, icon]);
  return null;
}
