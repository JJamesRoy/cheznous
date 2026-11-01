import { cn } from "@/lib/ui/cn";

/**
 * One settings block: label column (title + one-line description) and its panel.
 * Stacks on phones; label column ~240px on desktop.
 */
export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("grid scroll-mt-20 grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10 lg:scroll-mt-8", className)}
    >
      <div className="flex flex-col gap-1 md:pt-4">
        <h2 id={`${id}-title`} className="text-md font-semibold">
          {title}
        </h2>
        {description ? <p className="text-sm text-pretty text-fg-subtle">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

/** White panel on the greystone ground (no border: tone step). */
export function Panel({ children, className, padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn("min-w-0 rounded-card bg-surface", padded && "p-4 md:p-5", className)}>{children}</div>;
}

/** A labelled line inside a panel, separated by hairlines. */
export function PanelRow({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 [&+&]:border-t [&+&]:border-border", className)}>
      <div className="flex min-w-0 flex-col">
        <span className="text-base text-fg">{label}</span>
        {hint ? <span className="text-sm text-fg-subtle">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-negative">
      {children}
    </p>
  );
}
