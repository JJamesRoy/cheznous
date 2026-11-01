"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";
import { useOptionalShell } from "./shell-context";

export type PageHeaderProps = {
  title: string;
  description?: React.ReactNode;
  /** Buttons shown right of the title (desktop) / in the top bar (mobile). */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Page title + actions. On desktop it renders an <h1> header in the page;
 * on mobile the title goes to the shell's top bar and the actions are
 * portaled next to the privacy toggle.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  const shell = useOptionalShell();
  const setMobileTitle = shell?.setMobileTitle;

  useEffect(() => {
    if (!setMobileTitle) return;
    setMobileTitle(title);
    return () => setMobileTitle(null);
  }, [setMobileTitle, title]);

  return (
    <>
      <header
        className={cn(
          shell ? "hidden lg:flex" : "flex",
          "min-h-10 items-center justify-between gap-4 pb-6",
          className,
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-xl font-semibold">{title}</h1>
          {description ? <p className="text-base text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {shell?.mobileActionsSlot && actions ? createPortal(actions, shell.mobileActionsSlot) : null}
    </>
  );
}
