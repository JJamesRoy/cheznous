"use client";

import { X } from "lucide-react";
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from "radix-ui";
import { forwardRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { Button, IconButton } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const overlayClasses = "cn-overlay fixed inset-0 z-50 bg-overlay";

export type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Accessible title (rendered visually unless `hideTitle`). */
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
  /** Show the × button (default true). */
  closable?: boolean;
  /** `top` positions the dialog near the top (command menu). */
  placement?: "center" | "top";
};

/** Centered modal dialog, max 480px, 20px radius, blur-in enter. */
export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  {
    title,
    description,
    hideTitle = false,
    closable = true,
    placement = "center",
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "cn-dialog fixed left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 flex-col overflow-hidden",
          "rounded-sheet border border-border-strong bg-surface text-fg shadow-float",
          placement === "center" ? "top-1/2 -translate-y-1/2" : "top-[max(16px,12dvh)]",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className={cn("flex items-start gap-3 px-5 pt-5", hideTitle && "sr-only")}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogPrimitive.Title className="text-md font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-base text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {closable && !hideTitle ? (
            <DialogPrimitive.Close asChild>
              <IconButton label="Fermer" size="icon-sm" className="-mt-1 -mr-2 text-fg-subtle">
                <X aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          ) : null}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get the danger style on the confirm button. */
  destructive?: boolean;
  /** May be async: the button shows a spinner and the dialog stays open until it resolves. */
  onConfirm: () => void | Promise<void>;
};

/** Confirmation (alert dialog). Focus starts on "Annuler". */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm(event: React.MouseEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertPrimitive.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlayClasses} />
        <AlertPrimitive.Content
          className={cn(
            "cn-dialog fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2",
            "rounded-sheet border border-border-strong bg-surface p-5 text-fg shadow-float",
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <AlertPrimitive.Title className="text-md font-semibold">{title}</AlertPrimitive.Title>
          {description ? (
            <AlertPrimitive.Description className="mt-1.5 text-base text-fg-muted">
              {description}
            </AlertPrimitive.Description>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertPrimitive.Cancel>
            <AlertPrimitive.Action asChild>
              <Button
                variant={destructive ? "secondary" : "primary"}
                className={destructive ? "text-negative" : undefined}
                loading={pending}
                onClick={handleConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
