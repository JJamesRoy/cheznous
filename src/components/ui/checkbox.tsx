"use client";

import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";

export type CheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  "checked" | "onCheckedChange" | "children"
> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; when set, the whole row (≥ 44px) is the hit area. */
  label?: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  /** Strike through the label when checked (shopping items, tasks). */
  strikeWhenChecked?: boolean;
  /** Round variant for tasks. */
  shape?: "square" | "round";
};

/**
 * Checkbox with a drawn checkmark (SVG stroke-dashoffset, 220ms). Vibrates
 * lightly on check where supported.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  {
    checked,
    onCheckedChange,
    label,
    description,
    strikeWhenChecked = false,
    shape = "square",
    className,
    id: idProp,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `cb-${autoId}`;

  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={id}
      checked={checked}
      onCheckedChange={(value) => {
        const next = value === true;
        if (next) haptic("light");
        onCheckedChange?.(next);
      }}
      className={cn(
        "group/cb relative inline-flex size-5 shrink-0 items-center justify-center border border-border-strong bg-surface",
        "data-[state=checked]:border-accent disabled:opacity-50",
        // Invisible 44px hit area when used standalone.
        !label && "before:absolute before:-inset-3 before:content-['']",
        shape === "round" ? "rounded-full" : "rounded-control",
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "cn-check-fill absolute -inset-px bg-accent",
          shape === "round" ? "rounded-full" : "rounded-control",
        )}
      />
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="relative size-3.5 text-accent-fg"
      >
        <path
          className="cn-check-path"
          d="M4.5 10.5 8.25 14 15.5 6.5"
          pathLength={1}
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </CheckboxPrimitive.Root>
  );

  if (!label) return box;

  return (
    <div className={cn("flex min-h-11 items-center gap-3", className)}>
      {box}
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col py-2 select-none">
        <span
          className={cn(
            "text-base text-fg",
            strikeWhenChecked && checked && "text-fg-subtle line-through decoration-fg-subtle",
          )}
        >
          {label}
        </span>
        {description ? <span className="text-sm text-fg-subtle">{description}</span> : null}
      </label>
    </div>
  );
});
