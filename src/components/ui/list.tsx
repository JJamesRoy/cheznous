import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/** Card holding rows, separated by inset hairlines. */
export function ListGroup({
  className,
  children,
  "aria-label": ariaLabel,
  as: Element = "div",
}: {
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  /** Use `ul` when every child is a list item. */
  as?: "div" | "ul";
}) {
  return (
    <Element
      aria-label={ariaLabel}
      className={cn(
        "cn-list overflow-hidden rounded-card bg-surface",
        className,
      )}
    >
      {children}
    </Element>
  );
}

type RowBaseProps = {
  /** Icon, avatar or checkbox before the text. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Secondary line (meta: date, payer, category). */
  description?: React.ReactNode;
  /** Amount, badge, switch, button… after the text. */
  trailing?: React.ReactNode;
  /** Show a chevron (navigation rows). Defaults to true when `href` is set. */
  chevron?: boolean;
  /** 40px rows for desktop tables. */
  dense?: boolean;
  className?: string;
};

export type RowProps = RowBaseProps &
  (
    | { href: string; onClick?: never; "aria-label"?: string }
    | { href?: never; onClick?: React.MouseEventHandler<HTMLButtonElement>; "aria-label"?: string }
  );

/**
 * List row (52px min). Renders a Next <Link> with `href`, a <button> with
 * `onClick`, or a plain container (when its content is interactive itself).
 */
export function Row(props: RowProps) {
  const {
    leading,
    title,
    description,
    trailing,
    chevron,
    dense = false,
    className,
  } = props;
  const interactive = Boolean(props.href || props.onClick);
  const showChevron = chevron ?? Boolean(props.href);

  const content = (
    <>
      {leading ? (
        <span className="flex shrink-0 items-center text-fg-subtle [&>svg]:size-5">{leading}</span>
      ) : null}
      <span
        className={cn(
          "cn-row-sep relative flex min-w-0 flex-1 items-center gap-3 self-stretch pr-4",
          dense ? "min-h-10" : "min-h-[52px]",
        )}
      >
        <span className={cn("flex min-w-0 flex-1 flex-col", dense ? "py-2" : "py-2.5")}>
          <span className="truncate text-base text-fg">{title}</span>
          {description ? (
            <span className="truncate text-sm text-fg-subtle">{description}</span>
          ) : null}
        </span>
        {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
        {showChevron ? (
          <ChevronRight aria-hidden className="-mr-1 size-4 shrink-0 text-gray-8" />
        ) : null}
      </span>
    </>
  );

  const classes = cn(
    "group/row relative flex w-full items-center gap-3 bg-surface pl-4 text-left",
    interactive && "pressable cursor-pointer hover:bg-surface-2 active:bg-surface-pressed",
    interactive && "focus-visible:-outline-offset-2",
    className,
  );

  if (props.href) {
    return (
      <Link href={props.href} className={classes} aria-label={props["aria-label"]}>
        {content}
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={classes} aria-label={props["aria-label"]}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
