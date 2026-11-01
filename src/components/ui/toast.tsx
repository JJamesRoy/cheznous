"use client";

import { toast as sonnerToast, Toaster as SonnerToaster, type ExternalToast } from "sonner";
import { useTheme } from "@/lib/ui/theme";
import { useIsDesktop } from "@/lib/ui/use-media-query";

export const toast = sonnerToast;

/**
 * Toast with an "Annuler" action, for actions whose result is not already
 * visible on screen ("Dépense supprimée · Annuler").
 */
export function undoable(
  message: React.ReactNode,
  onUndo: () => unknown,
  options: ExternalToast & { undoLabel?: string } = {},
): string | number {
  const { undoLabel = "Annuler", ...rest } = options;
  return sonnerToast(message, {
    duration: 6000,
    ...rest,
    action: {
      label: undoLabel,
      onClick: () => {
        void onUndo();
      },
    },
  });
}

/**
 * Styled Sonner toaster: bottom-center on mobile (above the tab bar and the
 * safe area), bottom-right on desktop. Stacked, our tokens, no rich colors.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  const desktop = useIsDesktop();
  return (
    <SonnerToaster
      theme={resolvedTheme}
      position={desktop ? "bottom-right" : "bottom-center"}
      offset={{ bottom: "var(--toast-bottom)", right: 24, left: 24 }}
      mobileOffset={{ bottom: "var(--toast-bottom)", left: 12, right: 12 }}
      gap={8}
      visibleToasts={3}
      containerAriaLabel="Notifications"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-card border border-border-strong bg-surface px-4 py-3 text-base text-fg shadow-float md:w-[356px]",
          title: "font-medium",
          description: "text-sm text-fg-muted",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          icon: "flex size-4 shrink-0 items-center [&_svg]:size-4",
          actionButton:
            "pressable -my-1 -mr-2 inline-flex h-9 shrink-0 items-center rounded-control px-3 text-base font-medium text-accent hover:bg-surface-2 md:h-8",
          cancelButton:
            "pressable -my-1 inline-flex h-9 shrink-0 items-center rounded-control px-3 text-base text-fg-muted hover:bg-surface-2 md:h-8",
          error: "[&_[data-icon]]:text-negative",
          success: "[&_[data-icon]]:text-positive",
          warning: "[&_[data-icon]]:text-warning",
        },
      }}
    />
  );
}
