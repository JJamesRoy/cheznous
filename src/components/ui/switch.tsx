"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/ui/cn";

export type SwitchProps = Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  "children"
> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
};

/** On/off switch. The thumb slides (transform), the accent fill fades in. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, description, className, id: idProp, ...props },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `sw-${autoId}`;
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={id}
      className={cn(
        "group/sw relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-gray-6 p-0.5",
        "before:absolute before:-inset-2.5 before:content-[''] disabled:opacity-50",
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-primary opacity-0 transition-opacity duration-150 group-data-[state=checked]/sw:opacity-100"
      />
      <SwitchPrimitive.Thumb
        className={cn(
          "relative block size-5 rounded-full bg-surface",
          "transition-transform duration-150 ease-snappy data-[state=checked]:translate-x-4",
          "dark:bg-gray-12",
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-4", className)}>
      <label htmlFor={id} className="flex min-w-0 flex-col py-2 select-none">
        <span className="text-base text-fg">{label}</span>
        {description ? <span className="text-sm text-fg-subtle">{description}</span> : null}
      </label>
      {control}
    </div>
  );
});
