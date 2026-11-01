"use client";

import { Check } from "lucide-react";
import { DropdownMenu as Menu } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";
import { floatingSurface } from "./popover";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Menu.Content>
>(function DropdownMenuContent(
  { className, sideOffset = 6, collisionPadding = 12, align = "start", style, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        style={{
          ["--cn-origin" as string]: "var(--radix-dropdown-menu-content-transform-origin)",
          ...style,
        }}
        className={cn("cn-float z-50 min-w-48 overflow-hidden p-1", floatingSurface, className)}
        {...props}
      />
    </Menu.Portal>
  );
});

const itemClasses =
  "relative flex h-11 cursor-default items-center gap-2.5 rounded-control px-2.5 text-input outline-none select-none md:h-8 " +
  "data-highlighted:bg-surface-2 data-disabled:text-fg-disabled [&_svg]:size-4 [&_svg]:shrink-0";

export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof Menu.Item> & {
  icon?: React.ReactNode;
  shortcut?: string;
  destructive?: boolean;
};

export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  function DropdownMenuItem({ className, icon, shortcut, destructive, children, ...props }, ref) {
    return (
      <Menu.Item
        ref={ref}
        className={cn(itemClasses, destructive ? "text-negative" : "text-fg", className)}
        {...props}
      >
        {icon ? (
          <span className={cn("flex", destructive ? "text-negative" : "text-fg-subtle")}>{icon}</span>
        ) : null}
        <span className="flex-1 truncate">{children}</span>
        {shortcut ? <span className="text-xs text-fg-subtle">{shortcut}</span> : null}
      </Menu.Item>
    );
  },
);

export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Menu.RadioItem> & { icon?: React.ReactNode }
>(function DropdownMenuRadioItem({ className, icon, children, ...props }, ref) {
  return (
    <Menu.RadioItem ref={ref} className={cn(itemClasses, "pr-8 text-fg", className)} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      <Menu.ItemIndicator className="absolute right-2.5 flex text-accent">
        <Check aria-hidden />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
});

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

export function DropdownMenuLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Menu.Label className={cn("px-2.5 pt-1.5 pb-1 text-xs font-medium text-fg-subtle", className)}>
      {children}
    </Menu.Label>
  );
}
