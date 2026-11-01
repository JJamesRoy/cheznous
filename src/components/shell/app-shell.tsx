"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/ui/cn";
import type { CommandAction, CommandSearchResult } from "./command-menu";
import { titleForPath } from "./nav";
import { ShellContext, type ShellContextValue } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";
import { useGlobalShortcuts } from "./use-global-shortcuts";

// Loaded on first use: cmdk and the help sheet are not needed to paint a screen.
const CommandMenu = dynamic(() => import("./command-menu").then((m) => m.CommandMenu), { ssr: false });
const ShortcutsHelp = dynamic(() => import("./shortcuts-help").then((m) => m.ShortcutsHelp), { ssr: false });

export type AppShellProps = {
  user: { name: string; avatarUrl?: string | null };
  householdName: string;
  /** Opens the quick-add expense sheet (center "+", N, sidebar button). */
  onQuickAdd: () => void;
  /** Mobile top bar title; defaults to the current section's name. */
  title?: React.ReactNode;
  /** Extra buttons in the mobile top bar (left of the privacy toggle). */
  topBarActions?: React.ReactNode;
  /** ⌘K actions. Defaults to "Nouvelle dépense". */
  commandActions?: CommandAction[];
  /** ⌘K async search (notes). */
  search?: (query: string, signal: AbortSignal) => Promise<CommandSearchResult[]>;
  children: React.ReactNode;
};

/**
 * Application frame. Mobile: sticky top bar + bottom tab bar
 * (Accueil · Dépenses · + · Listes · Plus). Desktop (≥ 1024px): collapsible
 * sidebar, content up to 1100px. Also owns ⌘K, "?" and the global shortcuts.
 */
export function AppShell({
  user,
  householdName,
  onQuickAdd,
  title,
  topBarActions,
  commandActions,
  search,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Keep the lazy menus mounted after first use so their exit animation can play.
  const [commandUsed, setCommandUsed] = useState(false);
  const [helpUsed, setHelpUsed] = useState(false);
  if (commandOpen && !commandUsed) setCommandUsed(true);
  if (helpOpen && !helpUsed) setHelpUsed(true);
  const [mobileTitle, setMobileTitle] = useState<React.ReactNode | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const openCommandMenu = useCallback(() => {
    setHelpOpen(false);
    setCommandOpen(true);
  }, []);
  const openShortcuts = useCallback(() => {
    setCommandOpen(false);
    setHelpOpen(true);
  }, []);

  useGlobalShortcuts({
    onNewExpense: onQuickAdd,
    onOpenCommandMenu: () => setCommandOpen((open) => !open),
    onSearch: openCommandMenu,
    onOpenHelp: openShortcuts,
  });

  const actions = useMemo<CommandAction[]>(
    () =>
      commandActions ?? [
        { id: "new-expense", label: "Nouvelle dépense", shortcut: "N", icon: Plus, run: onQuickAdd },
      ],
    [commandActions, onQuickAdd],
  );

  const shell = useMemo<ShellContextValue>(
    () => ({
      openCommandMenu,
      openShortcuts,
      quickAdd: onQuickAdd,
      setMobileTitle,
      mobileActionsSlot: actionsSlot,
    }),
    [openCommandMenu, openShortcuts, onQuickAdd, actionsSlot],
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-app bg-bg">
        <Sidebar
          user={user}
          householdName={householdName}
          onQuickAdd={onQuickAdd}
          onOpenCommandMenu={openCommandMenu}
        />
        <div className="flex min-h-app flex-col lg:pl-(--sidebar-w)">
          <TopBar
            title={mobileTitle ?? title ?? titleForPath(pathname)}
            actions={topBarActions}
            actionsSlotRef={setActionsSlot}
          />
          <main
            id="contenu"
            className={cn(
              "mx-auto w-full max-w-[1100px] flex-1 px-4 pt-4 pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))]",
              "pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+24px)]",
              "md:px-6 lg:px-10 lg:pt-10 lg:pb-16",
            )}
          >
            {children}
          </main>
        </div>
        <TabBar onQuickAdd={onQuickAdd} />
      </div>
      {commandOpen || commandUsed ? (
        <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} actions={actions} search={search} />
      ) : null}
      {helpOpen || helpUsed ? <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} /> : null}
    </ShellContext.Provider>
  );
}
