import {
  Building,
  House,
  ListChecks,
  ListTodo,
  NotebookPen,
  PiggyBank,
  Receipt,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the "G then …" shortcut. */
  goKey?: string;
};

/** Every top-level route, in sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Accueil", icon: House, goKey: "d" },
  { href: "/depenses", label: "Dépenses", icon: Receipt, goKey: "e" },
  { href: "/budget", label: "Budget", icon: PiggyBank, goKey: "b" },
  { href: "/listes", label: "Listes", icon: ListChecks, goKey: "l" },
  { href: "/taches", label: "Tâches", icon: ListTodo, goKey: "t" },
  { href: "/notes", label: "Notes", icon: NotebookPen, goKey: "n" },
  { href: "/condo", label: "Condo", icon: Building, goKey: "c" },
  { href: "/objectifs", label: "Objectifs", icon: Target },
  { href: "/reglages", label: "Réglages", icon: Settings },
];

/** Routes reachable from the mobile "Plus" screen. */
export const PLUS_ITEMS: NavItem[] = ["/taches", "/notes", "/condo", "/objectifs", "/budget", "/reglages"]
  .map((href) => NAV_ITEMS.find((item) => item.href === href))
  .filter((item): item is NavItem => Boolean(item));

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Title for the mobile top bar, derived from the route. */
export function titleForPath(pathname: string): string {
  if (pathname === "/plus" || pathname.startsWith("/plus/")) return "Plus";
  const match = NAV_ITEMS.filter((item) => item.href !== "/").find((item) => isActive(pathname, item.href));
  return match?.label ?? "Chez Nous";
}
