"use client";

import { RadioGroup } from "radix-ui";
import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";

const chipBase =
  "pressable relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-base font-medium whitespace-nowrap select-none " +
  // Extend the hit area to 44px without changing the visual size.
  "before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] " +
  "disabled:text-fg-disabled [&_svg]:size-4";

const chipOff = "border-border-strong bg-surface text-fg-muted hover:text-fg hover:bg-surface-2";
const chipOn = "border-primary bg-primary text-primary-fg";

export type ChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Toggle state (renders aria-pressed). */
  pressed?: boolean;
};

/** Standalone toggle pill (filters). For one-of-many, use <ChipGroup>. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { pressed = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cn(chipBase, pressed ? chipOn : chipOff, className)}
      {...props}
    />
  );
});

export type ChipOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  leading?: React.ReactNode;
  disabled?: boolean;
};

export type ChipGroupProps<T extends string> = {
  value: T | null;
  onValueChange: (value: T) => void;
  options: ChipOption<T>[];
  "aria-label": string;
  /** Wrap onto several lines (default) or scroll horizontally. */
  layout?: "wrap" | "scroll";
  className?: string;
};

/**
 * Single-select pills, e.g. payer: "Moi · {Partenaire} · Compte commun".
 * Radio-group semantics with arrow-key navigation.
 */
export function ChipGroup<T extends string>({
  value,
  onValueChange,
  options,
  layout = "wrap",
  className,
  ...aria
}: ChipGroupProps<T>) {
  return (
    <RadioGroup.Root
      value={value ?? ""}
      onValueChange={(next) => onValueChange(next as T)}
      orientation="horizontal"
      aria-label={aria["aria-label"]}
      className={cn(
        "flex gap-2 py-1",
        layout === "wrap"
          ? "flex-wrap"
          : "-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(chipBase, option.value === value ? chipOn : chipOff)}
        >
          {option.leading}
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
