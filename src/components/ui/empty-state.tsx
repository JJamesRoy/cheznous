import { cn } from "@/lib/ui/cn";

/** One line of context + one clear action. No illustration. */
export function EmptyState({
  message,
  action,
  className,
}: {
  message: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-card border border-dashed border-border-strong px-6 py-10 text-center",
        className,
      )}
    >
      <p className="max-w-xs text-base text-fg-muted text-balance">{message}</p>
      {action}
    </div>
  );
}
