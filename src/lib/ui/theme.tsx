"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { THEME_COLORS } from "./boot-script";
import { createDatasetStore } from "./storage";
import { useMediaQuery } from "./use-media-query";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const themeStore = createDatasetStore<ThemePreference>({
  attribute: "theme",
  storageKey: "cn-theme",
  fallback: "system",
  parse: (raw) => (raw === "light" || raw === "dark" ? raw : "system"),
  toDataset: (value) => (value === "system" ? null : value),
});

type ThemeContextValue = {
  /** What the person chose. */
  theme: ThemePreference;
  /** What is actually applied. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function syncThemeColorMeta(theme: ThemePreference) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    const media = meta.getAttribute("media") ?? "";
    const natural = media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.setAttribute("content", theme === "system" ? natural : THEME_COLORS[theme]);
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.get,
    themeStore.getServerSnapshot,
  );
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    syncThemeColorMeta(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => themeStore.set(next), []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
