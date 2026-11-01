"use client";

import { Slot } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const base =
  "pressable relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium select-none " +
  "disabled:pointer-events-none disabled:text-fg-disabled aria-disabled:pointer-events-none " +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-[color-mix(in_srgb,var(--accent)_90%,var(--fg))] disabled:bg-surface-2",
  secondary:
    "bg-surface text-fg border border-border-strong hover:bg-surface-2 active:bg-surface-pressed disabled:bg-surface",
  ghost: "text-fg hover:bg-surface-2 active:bg-surface-pressed",
  "danger-ghost": "text-negative hover:bg-surface-2 active:bg-surface-pressed",
};

// Mobile sizes keep ≥ 44px targets; desktop tightens from md up.
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm md:h-8 [&_svg]:size-4",
  md: "h-11 px-4 text-base md:h-9 [&_svg]:size-4",
  lg: "h-12 px-5 text-md [&_svg]:size-5",
  icon: "size-11 md:size-9 [&_svg]:size-5 md:[&_svg]:size-4",
  "icon-sm": "size-9 md:size-8 [&_svg]:size-4",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, disables the button. */
  loading?: boolean;
  /** Render the child element (e.g. a Next <Link>) with button styles. */
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    asChild = false,
    className,
    children,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const classes = cn(base, variants[variant], sizes[size], className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, "size" | "aria-label"> & {
  /** Accessible name (required: icon buttons have no visible text). */
  label: string;
  size?: "icon" | "icon-sm";
};

/** Square icon-only button. Always pass `label`. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "icon", variant = "ghost", ...props },
  ref,
) {
  return <Button ref={ref} aria-label={label} size={size} variant={variant} {...props} />;
});
