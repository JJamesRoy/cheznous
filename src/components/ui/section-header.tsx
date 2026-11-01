import { cn } from "@/lib/ui/cn";

/** Title above a group of rows, with an optional trailing action. */
export function SectionHeader({
  title,
  description,
  action,
  as: Heading = "h2",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col">
        <Heading className="text-sm font-medium text-fg-muted">{title}</Heading>
        {description ? <p className="text-sm text-fg-subtle">{description}</p> : null}
      </div>
      {action ? <div className="-my-1 flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
