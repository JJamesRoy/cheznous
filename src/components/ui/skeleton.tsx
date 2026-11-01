import { cn } from "@/lib/ui/cn";

/**
 * Placeholder block. Give it the exact final size (h-/w- classes) so the
 * content replaces it without layout shift. Pulses with opacity only.
 */
export function Skeleton({
  className,
  shape = "control",
}: {
  className?: string;
  shape?: "control" | "card" | "pill" | "circle";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-skeleton bg-surface-2",
        shape === "control" && "rounded-control",
        shape === "card" && "rounded-card",
        (shape === "pill" || shape === "circle") && "rounded-full",
        className,
      )}
    />
  );
}

/** Text-line skeleton matching a type size (keeps line height). */
export function SkeletonText({
  className,
  size = "base",
}: {
  className?: string;
  size?: "sm" | "base" | "md" | "lg";
}) {
  const box = { sm: "h-[18px]", base: "h-5", md: "h-6", lg: "h-7" }[size];
  const bar = { sm: "h-3", base: "h-3.5", md: "h-4", lg: "h-5" }[size];
  return (
    <span aria-hidden className={cn("flex items-center", box, className)}>
      <span className={cn("block w-full animate-skeleton rounded-control bg-surface-2", bar)} />
    </span>
  );
}
