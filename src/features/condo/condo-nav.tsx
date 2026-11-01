"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/ui/cn";

export const CONDO_SECTIONS = [
  { href: "/condo", label: "Aperçu" },
  { href: "/condo/hypotheque", label: "Hypothèque" },
  { href: "/condo/syndicat", label: "Syndicat et frais" },
  { href: "/condo/documents", label: "Documents" },
  { href: "/condo/entretien", label: "Entretien" },
  { href: "/condo/apport", label: "Apport" },
] as const;

/**
 * Condo sub-navigation: underline tabs. On a phone the strip scrolls inside
 * itself (never the page) and keeps the active tab in view.
 */
export function CondoNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Sections du condo" className="-mx-4 md:-mx-6 lg:mx-0 print:hidden">
      <ul className="flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] md:px-6 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {CONDO_SECTIONS.map((s) => {
          const active = s.href === "/condo" ? pathname === "/condo" : pathname.startsWith(s.href);
          return (
            <li key={s.href} className="shrink-0">
              <Link
                ref={active ? activeRef : undefined}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center px-2.5 text-base whitespace-nowrap focus-visible:-outline-offset-2",
                  active ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {s.label}
                {active ? <span aria-hidden className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-fg" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
