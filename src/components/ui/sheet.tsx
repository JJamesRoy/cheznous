"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Drawer } from "vaul";
import { cn } from "@/lib/ui/cn";
import { useIsMobile } from "@/lib/ui/use-media-query";
import { useVisualViewport } from "@/lib/ui/use-visual-viewport";
import { IconButton } from "./button";
import { overlayClasses } from "./dialog";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Keep the title for screen readers only. */
  hideTitle?: boolean;
  /** Optional element that opens the sheet. */
  trigger?: React.ReactElement;
  /** Desktop presentation (≥ 768px): centered dialog (default) or right side panel. */
  desktop?: "dialog" | "panel";
  /** Mobile snap points (Vaul), e.g. [0.5, 1]. */
  snapPoints?: (number | string)[];
  /** Allow closing by drag / overlay / Escape. Default true. */
  dismissible?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * One API for all create/edit flows:
 * - mobile (< 768px): Vaul bottom sheet with drag handle, safe-area padding,
 *   lifted above the on-screen keyboard (visualViewport);
 * - desktop: centered dialog (max 480px) or right side panel.
 * Put actions in <SheetFooter> as the last child: it sticks to the bottom.
 */
export function Sheet(props: SheetProps) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSheet {...props} /> : <DesktopSheet {...props} />;
}

function SheetHeader({
  title,
  description,
  hideTitle,
  Title,
  Description,
  Close,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
  Title: typeof DialogPrimitive.Title;
  Description: typeof DialogPrimitive.Description;
  Close: typeof DialogPrimitive.Close;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-3 px-4 pt-2 pb-3 md:px-5 md:pt-5",
        hideTitle && "sr-only",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5 md:pt-0">
        <Title className="text-md font-semibold text-fg">{title}</Title>
        {description ? (
          <Description className="text-base text-fg-muted">{description}</Description>
        ) : null}
      </div>
      <Close asChild>
        <IconButton label="Fermer" size="icon-sm" className="-mr-2 text-fg-subtle md:-mt-1">
          <X aria-hidden />
        </IconButton>
      </Close>
    </div>
  );
}

const bodyClasses =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]";
const innerClasses = "px-4 pb-4 md:px-5 md:pb-5 has-[.cn-sheet-footer]:pb-0";

function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle,
  trigger,
  snapPoints,
  dismissible = true,
  className,
  children,
}: SheetProps) {
  const { keyboardInset, height } = useVisualViewport();
  const snapProps = snapPoints ? { snapPoints, fadeFromIndex: snapPoints.length - 1 } : {};

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      dismissible={dismissible}
      repositionInputs={false}
      {...snapProps}
    >
      {trigger ? <Drawer.Trigger asChild>{trigger}</Drawer.Trigger> : null}
      <Drawer.Portal>
        <Drawer.Overlay className="cn-drawer-overlay fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          style={{
            bottom: keyboardInset,
            maxHeight: height
              ? `${height - 24}px`
              : "calc(100dvh - env(safe-area-inset-top) - 24px)",
          }}
          className={cn(
            "cn-drawer fixed inset-x-0 z-50 flex flex-col rounded-t-sheet border-t border-border-strong bg-surface text-fg shadow-float outline-none",
            keyboardInset === 0 && "pb-safe",
            className,
          )}
        >
          <div aria-hidden className="flex h-5 shrink-0 items-end justify-center">
            <span className="h-1 w-9 rounded-full bg-gray-6" />
          </div>
          <SheetHeader
            title={title}
            description={description}
            hideTitle={hideTitle}
            Title={Drawer.Title}
            Description={Drawer.Description}
            Close={Drawer.Close}
          />
          <div className={bodyClasses}>
            <div className={innerClasses}>{children}</div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DesktopSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle,
  trigger,
  desktop = "dialog",
  dismissible = true,
  className,
  children,
}: SheetProps) {
  const panel = desktop === "panel";
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClasses} />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          // Focus the sheet itself rather than the × button; fields that want
          // focus opt in (e.g. <MoneyInput autoFocus>).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-border-strong bg-surface text-fg shadow-float outline-none",
            panel
              ? "cn-panel top-2 right-2 bottom-2 w-[440px] max-w-[calc(100vw-16px)] rounded-sheet"
              : "cn-dialog top-1/2 left-1/2 max-h-[min(720px,calc(100dvh-48px))] w-[calc(100vw-48px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-sheet",
            className,
          )}
        >
          <SheetHeader
            title={title}
            description={description}
            hideTitle={hideTitle}
            Title={DialogPrimitive.Title}
            Description={DialogPrimitive.Description}
            Close={DialogPrimitive.Close}
          />
          <div className={bodyClasses}>
            <div className={innerClasses}>{children}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Sticky action bar at the bottom of a <Sheet> (safe-area aware on mobile). */
export function SheetFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "cn-sheet-footer sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-border bg-surface px-4 py-3 md:-mx-5 md:px-5 md:py-4",
        "[&>*]:flex-1 md:justify-end md:[&>*]:flex-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
