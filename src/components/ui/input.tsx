"use client";

import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/ui/cn";
import { parseMoneyInput, sanitizeMoneyInput } from "@/lib/ui/format";
import { useFieldControl } from "./field";

/** Shared look for text-like controls (input, textarea, select trigger, date). */
export const controlClasses =
  "w-full min-w-0 rounded-control border border-border-strong bg-surface text-fg text-input " +
  "placeholder:text-placeholder hover:border-gray-7 " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent focus-visible:border-transparent " +
  "aria-invalid:border-negative disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-disabled";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Element inside the field, before the text (icon, prefix). */
  leading?: React.ReactNode;
  /** Element inside the field, after the text (suffix, button). */
  trailing?: React.ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, trailing, type = "text", ...props },
  ref,
) {
  const control = useFieldControl(props);
  const input = (
    <input
      ref={ref}
      type={type}
      {...props}
      {...control}
      className={cn(
        controlClasses,
        "h-11 px-3 md:h-9",
        leading ? "pl-10 md:pl-9" : null,
        trailing ? "pr-10 md:pr-9" : null,
        className,
      )}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative flex w-full items-center">
      {leading ? (
        <span className="pointer-events-none absolute left-3 flex text-placeholder [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute right-1.5 flex items-center text-fg-subtle [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type" | "size"
> & {
  /** Raw text as typed, e.g. "85,50". */
  value: string;
  /** Receives sanitized text and the parsed cents (null if empty/invalid). */
  onValueChange: (text: string, cents: number | null) => void;
  /** `lg` is the hero amount of an add-expense sheet. */
  size?: "md" | "lg";
  autoFocus?: boolean;
};

/**
 * Amount field: numeric keypad (`inputMode="decimal"`), accepts "85,50" or
 * "85.50", shows the `$` suffix (fr-CA: amount then $). Font is ≥ 16px.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, size = "md", autoFocus, className, placeholder = "0,00", ...props },
  forwardedRef,
) {
  const control = useFieldControl(props);
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Defer so it runs after sheet open animations claim focus.
    const t = window.setTimeout(() => innerRef.current?.focus({ preventScroll: true }), 50);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const inputProps = {
    ref: setRefs,
    type: "text",
    inputMode: "decimal" as const,
    autoComplete: "off",
    enterKeyHint: "done" as const,
    spellCheck: false,
    placeholder,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const text = sanitizeMoneyInput(event.target.value);
      onValueChange(text, parseMoneyInput(text));
    },
    ...props,
    ...control,
  };

  if (size === "lg") {
    // Auto-sizing hero amount: the invisible mirror sets the width, the input
    // is laid over it, and the "$" follows the digits.
    return (
      <div className={cn("flex w-full items-baseline justify-center", className)}>
        <span className="relative inline-block max-w-full">
          <span
            aria-hidden
            className="num invisible block h-16 min-w-[1ch] overflow-hidden pr-0.5 text-2xl leading-[64px] font-semibold whitespace-pre"
          >
            {value || placeholder}
          </span>
          <input
            {...inputProps}
            size={1}
            className="num absolute inset-0 h-16 w-full min-w-0 bg-transparent p-0 text-2xl font-semibold text-fg caret-accent placeholder:text-gray-8 focus-visible:outline-none"
          />
        </span>
        <span aria-hidden className="ml-1.5 text-xl font-medium text-fg-subtle">
          $
        </span>
      </div>
    );
  }

  return (
    <div className={cn("relative flex w-full items-center", className)}>
      <input
        {...inputProps}
        className={cn(controlClasses, "num h-11 pr-8 pl-3 text-right md:h-9")}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 text-fg-subtle"
      >
        $
      </span>
    </div>
  );
});
