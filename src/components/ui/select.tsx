"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input";

export type SelectOption = {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

export type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
};

/** Radix Select with our trigger and an origin-aware popper menu. */
export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Choisir…",
  disabled,
  name,
  required,
  id,
  className,
  ...aria
}: SelectProps) {
  const control = useFieldControl({ id, required });
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      required={control.required}
    >
      <SelectPrimitive.Trigger
        id={control.id}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"]}
        aria-label={aria["aria-label"]}
        className={cn(
          controlClasses,
          "flex h-11 items-center justify-between gap-2 px-3 text-left md:h-9",
          "data-placeholder:text-placeholder [&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="shrink-0 text-fg-subtle">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          style={{ ["--cn-origin" as string]: "var(--radix-select-content-transform-origin)" }}
          className={cn(
            "cn-float z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden",
            "rounded-card border border-border-strong bg-surface p-1 shadow-float",
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex h-11 cursor-default items-center gap-2 rounded-control pr-8 pl-2.5 text-input outline-none select-none md:h-8",
                  "data-highlighted:bg-surface-2 data-disabled:text-fg-disabled [&_svg]:size-4",
                )}
              >
                {option.icon ? <span className="flex text-fg-subtle">{option.icon}</span> : null}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex text-accent">
                  <Check aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
