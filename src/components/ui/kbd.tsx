import { cn } from "@/lib/ui/cn";

/** Keyboard key hint. */
export function Kbd({
  children,
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  tone?: "default" | "inverted";
}) {
  return (
    <kbd
      {...props}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-control px-1 font-sans text-xs font-medium",
        tone === "default"
          ? "border border-border-strong bg-surface text-fg-muted"
          : "bg-gray-1/15 text-gray-1",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
