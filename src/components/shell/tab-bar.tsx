"use client";

import { Ellipsis, House, ListChecks, Plus, Receipt } from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";
import { isActive, PLUS_ITEMS } from "./nav";

const TABS = [
  { href: "/", label: "Accueil", icon: House },
  { href: "/depenses", label: "Dépenses", icon: Receipt },
  null,
  { href: "/listes", label: "Listes", icon: ListChecks },
  { href: "/plus", label: "Plus", icon: Ellipsis },
] as const;

const pillTransition = { duration: 0.22, ease: [0.23, 1, 0.32, 1] } as const;

function activeTab(pathname: string): string | null {
  for (const tab of TABS) if (tab && tab.href !== "/plus" && isActive(pathname, tab.href)) return tab.href;
  if (isActive(pathname, "/plus") || PLUS_ITEMS.some((item) => isActive(pathname, item.href))) return "/plus";
  return null;
}

/** Mobile bottom tab bar (hidden ≥ 1024px). */
export function TabBar({ onQuickAdd }: { onQuickAdd: () => void }) {
  const pathname = usePathname();
  const current = activeTab(pathname);
  return (
    <nav
      data-cn-tabbar=""
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg pb-safe lg:hidden"
    >
      <ul className="mx-auto grid h-(--tabbar-h) max-w-lg grid-cols-5 px-1">
        {TABS.map((tab) => {
          if (!tab) {
            return (
              <li key="add" className="flex items-center justify-center">
                <button
                  type="button"
                  aria-label="Nouvelle dépense"
                  onClick={() => {
                    haptic("light");
                    onQuickAdd();
                  }}
                  className="pressable flex size-12 items-center justify-center rounded-full bg-primary text-primary-fg"
                >
                  <Plus className="size-6" aria-hidden />
                </button>
              </li>
            );
          }
          const active = current === tab.href;
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "pressable flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-control focus-visible:-outline-offset-2",
                  active ? "text-fg" : "text-fg-subtle",
                )}
              >
                <span className="relative flex h-7 w-14 items-center justify-center">
                  {active ? (
                    <m.span
                      layoutId="cn-tab-pill"
                      transition={pillTransition}
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-active"
                    />
                  ) : null}
                  <Icon className="relative size-5" aria-hidden />
                </span>
                <span className={cn("text-xs", active && "font-medium")}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
