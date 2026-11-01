"use client";

import { Label as LabelPrimitive } from "radix-ui";
import { createContext, forwardRef, useContext, useId } from "react";
import { cn } from "@/lib/ui/cn";

type FieldContextValue = {
  id: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Props a form control spreads to wire itself to the surrounding <Field>
 * (id, aria-describedby, aria-invalid). Explicit props win.
 */
export function useFieldControl(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  required?: boolean;
}) {
  const field = useContext(FieldContext);
  const describedBy =
    [props["aria-describedby"], field?.errorId, field?.hintId].filter(Boolean).join(" ") ||
    undefined;
  return {
    id: props.id ?? field?.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid ? true : undefined),
    required: props.required ?? (field?.required || undefined),
  };
}

export const Label = forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn("text-sm font-medium text-fg select-none", className)}
      {...props}
    />
  );
});

export type FieldProps = {
  label: React.ReactNode;
  /** Short help shown under the control. */
  hint?: React.ReactNode;
  /** Error message; marks the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  /** Optional element aligned right of the label (e.g. a link). */
  labelAside?: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
};

/** Label + control + hint + error, wired for accessibility. */
export function Field({
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  labelAside,
  id: idProp,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const id = idProp ?? `field-${autoId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <FieldContext.Provider value={{ id, hintId, errorId, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className={cn("flex items-baseline justify-between gap-2", hideLabel && "sr-only")}>
          <Label htmlFor={id}>
            {label}
            {required ? (
              <span aria-hidden className="ml-0.5 text-fg-subtle">
                *
              </span>
            ) : null}
          </Label>
          {labelAside}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="text-sm text-negative" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-sm text-fg-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
