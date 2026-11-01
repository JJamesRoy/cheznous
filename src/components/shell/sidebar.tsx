"use client";

import { PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { useModKeyLabel } from "@/lib/ui/use-hotkeys";
import { useSidebarCollapsed } from "@/lib/ui/sidebar-state";
import { isActive, NAV_ITEMS } from "./nav";
import { PrivacyToggle } from "./privacy-toggle";

export type SidebarProps = {
  user: { name: string; avatarUrl?: string | null };
  householdName: string;
  onQuickAdd: () => void;
  onOpenCommandMenu: () => void;
};

/**
 * Desktop sidebar (≥ 1024px), 240px ↔ 56px. The width comes from
 * `--sidebar-w`, decided before paint from localStorage (no layout shift).
 */
export function Sidebar({ user, householdName, onQuickAdd, onOpenCommandMenu }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const mod = useModKeyLabel();

  return (
    <aside
      aria-label="Barre latérale"
      className="fixed inset-y-0 left-0 z-30 hidden w-(--sidebar-w) flex-col border-r border-border bg-bg-subtle lg:flex"
    >
      {/* Household + collapse */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <span data-sidebar-label="" className="min-w-0 flex-1 truncate pl-1 text-base font-semibold">
          {householdName}
        </span>
        <Tooltip content={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"} side="right">
          <button
            type="button"
            aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className="pressable flex size-8 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <PanelLeftClose data-sidebar-label="" className="size-4" aria-hidden />
            <PanelLeftOpen data-sidebar-collapsed-only="" className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>

      {/* Primary actions */}
      <div className="flex shrink-0 flex-col gap-1 px-3 pb-3">
        <Tooltip content="Nouvelle dépense" shortcut={["N"]} side="right" enabled={collapsed}>
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label="Nouvelle dépense"
            className="pressable flex h-8 items-center gap-2 rounded-control bg-primary px-2 text-base font-medium text-primary-fg hover:bg-primary-hover"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            <span data-sidebar-label="" className="flex-1 truncate text-left">
              Nouvelle dépense
            </span>
            <Kbd data-sidebar-label="" tone="inverted" className="bg-primary-fg/15 text-primary-fg">
              N
            </Kbd>
          </button>
        </Tooltip>
        <Tooltip content="Rechercher" shortcut={[mod, "K"]} side="right" enabled={collapsed}>
          <button
            type="button"
            onClick={onOpenCommandMenu}
            aria-label="Rechercher"
            className="pressable flex h-8 items-center gap-2 rounded-control px-2 text-base text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span data-sidebar-label="" className="flex-1 truncate text-left">
              Rechercher
            </span>
            <span data-sidebar-label="" className="flex gap-0.5">
              <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </Tooltip>
      </div>

      {/* Navigation */}
      <nav aria-label="Navigation principale" className="min-h-0 flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Tooltip content={item.label} side="right" enabled={collapsed}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-control px-2 text-base",
                      active
                        ? "bg-active font-semibold text-fg"
                        : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span data-sidebar-label="" className="truncate">
                      {item.label}
                    </span>
                  </Link>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: privacy + user */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-3">
        <div className="flex items-center gap-2 [:root[data-sidebar=collapsed]_&]:flex-col">
          <Link
            href="/reglages"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-control p-1 hover:bg-surface-2"
            aria-label={`${user.name} · Réglages`}
          >
            <Avatar name={user.name} src={user.avatarUrl} size="sm" decorative />
            <span data-sidebar-label="" className="min-w-0 truncate text-base">
              {user.name}
            </span>
          </Link>
          <PrivacyToggle size="icon-sm" />
        </div>
      </div>
    </aside>
  );
}
