"use client";

import { createContext, useContext } from "react";

export type ShellContextValue = {
  openCommandMenu: () => void;
  openShortcuts: () => void;
  quickAdd: () => void;
  /** Mobile top bar title override (set by <PageHeader>). */
  setMobileTitle: (title: React.ReactNode | null) => void;
  /** Portal target for page actions in the mobile top bar. */
  mobileActionsSlot: HTMLElement | null;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** Shell actions for pages (open ⌘K, open the shortcuts sheet, quick add). */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
