"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";
import { Kbd } from "./kbd";

export const TooltipProvider = TooltipPrimitive.Provider;

export type TooltipProps = {
  content: React.ReactNode;
  /** Keyboard shortcut shown after the text, e.g. ["⌘", "K"]. */
  shortcut?: string[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Render nothing extra when false (e.g. only show when sidebar is collapsed). */
  enabled?: boolean;
  children: React.ReactElement;
};

/**
 * Tooltip: in after the provider delay (400ms), out instantly. Hover/focus
 * hints only — never put essential information here (no tooltips on touch).
 */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  align = "center",
  enabled = true,
  children,
}: TooltipProps) {
  if (!enabled) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "cn-tooltip z-50 flex items-center gap-2 rounded-control bg-gray-12 px-2 py-1 text-sm text-gray-1 shadow-float select-none",
          )}
        >
          {content}
          {shortcut ? (
            <span className="flex gap-0.5">
              {shortcut.map((key) => (
                <Kbd key={key} tone="inverted">
                  {key}
                </Kbd>
              ))}
            </span>
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
