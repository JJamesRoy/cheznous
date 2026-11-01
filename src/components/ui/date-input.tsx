"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input";

export type DateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  /** ISO date `YYYY-MM-DD` ("" when empty). */
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Native date input, styled like our fields. Mobile gets the OS picker
 * (wheels on iOS, calendar on Android); the value is always ISO.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onValueChange, className, ...props },
  ref,
) {
  const control = useFieldControl(props);
  return (
    <input
      ref={ref}
      type="date"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      {...props}
      {...control}
      className={cn(
        controlClasses,
        "num flex h-11 appearance-none items-center px-3 md:h-9",
        // iOS collapses empty date inputs: keep the height and alignment.
        "[&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left",
        className,
      )}
    />
  );
});
