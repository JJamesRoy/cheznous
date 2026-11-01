"use client";

import { useRouter } from "next/navigation";
import { useHotkeys, type HotkeyBinding } from "@/lib/ui/use-hotkeys";
import { NAV_ITEMS } from "./nav";

export type GlobalShortcutsOptions = {
  /** N */
  onNewExpense?: () => void;
  /** ⌘K / Ctrl+K */
  onOpenCommandMenu?: () => void;
  /** / */
  onSearch?: () => void;
  /** ? */
  onOpenHelp?: () => void;
  enabled?: boolean;
};

/**
 * App-wide shortcuts: "G then D/E/B/L/T/N/C" navigation, N new expense,
 * ⌘K commands, / search, ? help. (⌘⇧H privacy lives in PrivacyProvider.)
 */
export function useGlobalShortcuts({
  onNewExpense,
  onOpenCommandMenu,
  onSearch,
  onOpenHelp,
  enabled = true,
}: GlobalShortcutsOptions = {}): void {
  const router = useRouter();

  const bindings: HotkeyBinding[] = NAV_ITEMS.filter((item) => item.goKey).map((item) => ({
    keys: `g ${item.goKey}`,
    handler: () => router.push(item.href),
  }));
  if (onNewExpense) bindings.push({ keys: "n", handler: onNewExpense });
  if (onOpenCommandMenu) bindings.push({ keys: "mod+k", handler: onOpenCommandMenu });
  if (onSearch) bindings.push({ keys: "/", handler: onSearch });
  if (onOpenHelp) bindings.push({ keys: "?", handler: onOpenHelp });

  useHotkeys(bindings, { enabled });
}
