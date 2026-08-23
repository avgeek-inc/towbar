export const THEME_STORAGE_KEY = "towbar-ui-theme";

export const themeModes = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof themeModes)[number];
export type ResolvedTheme = Exclude<ThemeMode, "system">;

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && themeModes.includes(value as ThemeMode);
}

const serializedStorageKey = JSON.stringify(THEME_STORAGE_KEY);

export const themeBootstrapScript = `(() => {
  const root = document.documentElement;
  let mode = "system";

  try {
    const storedMode = localStorage.getItem(${serializedStorageKey});
    if (storedMode === "light" || storedMode === "dark" || storedMode === "system") {
      mode = storedMode;
    }
  } catch {}

  const resolved = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
})();`;
