"use client";

import * as React from "react";

import {
  isThemeMode,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from "../lib/theme";

interface ThemeContextValue {
  isHydrated: boolean;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (themeMode: ThemeMode) => void;
  themeMode: ThemeMode;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
let transitionCleanupTimer: number | undefined;

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === "system" ? getSystemTheme() : themeMode;
}

function readStoredThemeMode(): ThemeMode {
  try {
    const storedThemeMode = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(storedThemeMode) ? storedThemeMode : "system";
  } catch {
    return "system";
  }
}

function applyTheme(
  themeMode: ThemeMode,
  disableTransitions: boolean,
): ResolvedTheme {
  const root = document.documentElement;
  const resolvedTheme = resolveTheme(themeMode);

  if (disableTransitions) {
    root.classList.add("theme-changing");
    if (transitionCleanupTimer) window.clearTimeout(transitionCleanupTimer);
    transitionCleanupTimer = window.setTimeout(() => {
      root.classList.remove("theme-changing");
      transitionCleanupTimer = undefined;
    }, 50);
  }

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = themeMode;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ResolvedTheme>("light");
  const [isHydrated, setIsHydrated] = React.useState(false);

  const commitTheme = React.useCallback(
    (
      nextThemeMode: ThemeMode,
      options: { disableTransitions: boolean; persist: boolean },
    ) => {
      if (options.persist) {
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode);
        } catch {
          // The selected theme still applies when storage is unavailable.
        }
      }
      setThemeModeState(nextThemeMode);
      setResolvedTheme(applyTheme(nextThemeMode, options.disableTransitions));
    },
    [],
  );

  React.useEffect(() => {
    const initialThemeMode = isThemeMode(
      document.documentElement.dataset.themeMode,
    )
      ? document.documentElement.dataset.themeMode
      : readStoredThemeMode();
    commitTheme(initialThemeMode, {
      disableTransitions: false,
      persist: false,
    });
    setIsHydrated(true);
  }, [commitTheme]);

  React.useEffect(() => {
    if (themeMode !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setResolvedTheme(applyTheme("system", true));
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [themeMode]);

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      commitTheme(isThemeMode(event.newValue) ? event.newValue : "system", {
        disableTransitions: true,
        persist: false,
      });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [commitTheme]);

  const setThemeMode = React.useCallback(
    (nextThemeMode: ThemeMode) =>
      commitTheme(nextThemeMode, {
        disableTransitions: true,
        persist: true,
      }),
    [commitTheme],
  );
  const value = React.useMemo(
    () => ({ isHydrated, resolvedTheme, setThemeMode, themeMode }),
    [isHydrated, resolvedTheme, setThemeMode, themeMode],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within Providers");
  return context;
}
