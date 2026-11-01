"use client";

import { m } from "motion/react";
import { RadioGroup } from "radix-ui";
import { useId } from "react";
import { cn } from "@/lib/ui/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch segments to fill the width. Default true. */
  fill?: boolean;
  className?: string;
};

const pillTransition = { duration: 0.22, ease: [0.23, 1, 0.32, 1] } as const;

/**
 * Single choice among 2–4 options (split mode, period). Radio-group
 * semantics, arrow keys move; the active pill slides (Motion layoutId).
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  fill = true,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const pillId = `seg-pill-${useId()}`;
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      orientation="horizontal"
      aria-label={aria["aria-label"]}
      className={cn(
        "relative inline-flex rounded-control bg-surface-2 p-0.5",
        fill ? "flex w-full" : "self-start",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "relative inline-flex min-w-0 items-center justify-center rounded-control px-3 font-medium whitespace-nowrap select-none",
              "focus-visible:outline-offset-0",
              size === "sm" ? "h-8 text-sm md:h-7" : "h-10 text-base md:h-8",
              fill && "flex-1",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
              "disabled:text-fg-disabled",
            )}
          >
            {active ? (
              <m.span
                layoutId={pillId}
                transition={pillTransition}
                aria-hidden
                className="absolute inset-0 rounded-control border border-border bg-surface dark:bg-gray-5"
              />
            ) : null}
            <span className="relative truncate">{option.label}</span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
