import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/** The house outline from /icons/icon.svg, drawn with currentColor. */
export function HouseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <g
        transform="translate(40 40) scale(0.84375)"
        fill="none"
        stroke="currentColor"
        strokeWidth={34}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M112 244 L256 128 L400 244" />
        <path d="M152 214 V384 H360 V214" />
        <path d="M226 384 V304 H286 V384" />
      </g>
    </svg>
  );
}

/** Small brand lockup: glyph + wordmark. */
export function BrandLockup({ href = "/", className }: { href?: string | null; className?: string }) {
  const inner = (
    <>
      <HouseGlyph className="size-6 text-fg" />
      <span className="text-base font-semibold tracking-tight text-fg">Chez Nous</span>
    </>
  );
  if (!href) return <span className={cn("inline-flex items-center gap-1.5", className)}>{inner}</span>;
  return (
    <Link href={href} className={cn("-mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1", className)}>
      {inner}
    </Link>
  );
}

/**
 * Calm full-page frame for signed-out and pre-household screens (no app shell):
 * brand on top, a single narrow column, optional footer line.
 */
export function AuthFrame({
  children,
  footer,
  width = "narrow",
  brandHref = "/",
  aside,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "narrow" | "wide";
  brandHref?: string | null;
  /** Element at the right of the top bar (e.g. sign out). */
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg pt-safe pr-safe pb-safe pl-safe">
      <header className="mx-auto flex h-14 w-full max-w-[1100px] shrink-0 items-center justify-between gap-3 px-4 md:h-16 md:px-8">
        <BrandLockup href={brandHref} />
        {aside ? <div className="flex items-center gap-1">{aside}</div> : null}
      </header>
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col px-4 pt-6 pb-12 md:px-8 md:pt-[10vh]">
        <div className={cn("flex w-full flex-col", width === "narrow" ? "max-w-[400px]" : "max-w-[560px]")}>{children}</div>
      </main>
      {footer ? <footer className="mx-auto w-full max-w-[1100px] px-4 pb-6 text-sm text-fg-subtle md:px-8">{footer}</footer> : null}
    </div>
  );
}

/** Page title block used at the top of auth/onboarding columns. */
export function AuthHeading({
  title,
  description,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-col gap-2", className)}>
      {eyebrow ? <p className="text-sm font-medium text-fg-subtle">{eyebrow}</p> : null}
      <h1 className="text-xl font-semibold text-balance text-fg">{title}</h1>
      {description ? <p className="text-base text-pretty text-fg-muted">{description}</p> : null}
    </div>
  );
}

/** Inline status message (error / info) with the right live-region role. */
export function FormNotice({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control px-3 py-2.5 text-base",
        tone === "error" ? "bg-[color-mix(in_srgb,var(--negative)_8%,transparent)] text-negative" : "bg-surface-2 text-fg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}
