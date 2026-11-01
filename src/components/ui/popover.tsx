"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const floatingSurface =
  "rounded-card border border-border-strong bg-surface text-fg shadow-float";

export const PopoverContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 6, collisionPadding = 12, style, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={{
          ["--cn-origin" as string]: "var(--radix-popover-content-transform-origin)",
          ...style,
        }}
        className={cn("cn-float z-50 w-72 max-w-[calc(100vw-24px)] p-3", floatingSurface, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
