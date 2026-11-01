"use client";

import { cn } from "@/lib/ui/cn";
import { PrivacyToggle } from "./privacy-toggle";

/** Mobile top bar: title, page actions slot, privacy toggle. */
export function TopBar({
  title,
  actions,
  actionsSlotRef,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  actionsSlotRef: (node: HTMLDivElement | null) => void;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-bg pt-safe pr-safe pl-safe lg:hidden",
        className,
      )}
    >
      <div className="flex h-(--topbar-h) items-center gap-1 pr-2 pl-4">
        <h1 className="min-w-0 flex-1 truncate text-md font-semibold">{title}</h1>
        <div ref={actionsSlotRef} className="flex items-center gap-1 empty:hidden" />
        {actions}
        <PrivacyToggle />
      </div>
    </header>
  );
}
