"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Grow with content (CSS field-sizing where supported). Default true. */
  autoGrow?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = true, rows = 3, ...props },
  ref,
) {
  const control = useFieldControl(props);
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...props}
      {...control}
      className={cn(
        controlClasses,
        "min-h-24 resize-none px-3 py-2.5 md:py-2",
        autoGrow && "field-sizing-content max-h-80",
        className,
      )}
    />
  );
});
