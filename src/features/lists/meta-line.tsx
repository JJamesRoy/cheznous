import { cn } from "@/lib/ui/cn";

/**
 * Secondary line of a row: "Demain · Important · 0/2". Items wrap on narrow screens and the
 * separator dot at the start of a wrapped line is clipped away (negative margin + overflow).
 */
export function MetaLine({ items, className }: { items: React.ReactNode[]; className?: string }) {
  if (!items.length) return null;
  return (
    <span className={cn("block overflow-hidden text-sm text-fg-subtle", className)}>
      <span className="-ml-3.5 flex flex-wrap items-center">
        {items.map((node, i) => (
          <span key={i} className="inline-flex items-center before:inline-block before:w-3.5 before:text-center before:content-['·']">
            {node}
          </span>
        ))}
      </span>
    </span>
  );
}
