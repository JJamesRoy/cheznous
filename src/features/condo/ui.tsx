"use client";

import { RotateCw, WifiOff } from "lucide-react";
import { Button, SectionHeader, Skeleton } from "@/components/ui";
import { formatDateFr, formatDateShortFr, relativeDayFr } from "@/domain/dates";
import type { ApiError } from "@/lib/data/api";
import { cn } from "@/lib/ui/cn";

/** Shared building blocks for the budget, condo and goals screens. */

export function fmtDate(d: string | null | undefined): string {
  return d ? formatDateFr(d) : "—";
}

export function fmtDateShort(d: string | null | undefined): string {
  return d ? formatDateShortFr(d) : "—";
}

/** "aujourd'hui", "dans 12 jours", "il y a 3 jours", with months/years for long spans. */
export function relativeFr(d: string, today: string): string {
  const base = relativeDayFr(d, today);
  const m = /(\d+) jours/.exec(base);
  if (!m) return base;
  const n = Number(m[1]);
  if (n < 60) return base;
  const future = d > today;
  const months = Math.round(n / 30.44);
  const label = months >= 24 ? `${Math.round(months / 12)} ans` : `${months} mois`;
  return future ? `dans ${label}` : `il y a ${label}`;
}

export function errorText(error: unknown): string {
  if (!error) return "";
  const e = error as ApiError;
  if (e.code === "NETWORK") return "Hors ligne : ces données s'afficheront au retour du réseau.";
  return e.message || "Une erreur est survenue.";
}

/** Inline error with "Réessayer" (offline gets its own message). */
export function QueryError({
  error,
  onRetry,
  what,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  /** What failed, e.g. "le budget". */
  what?: string;
  className?: string;
}) {
  const offline = (error as ApiError | null)?.code === "NETWORK";
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-card bg-surface p-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {offline ? <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" /> : null}
        <p className="text-base text-fg-muted">
          {offline
            ? "Tu es hors ligne. Les données s'afficheront au retour du réseau."
            : `Impossible de charger ${what ?? "ces données"}. ${errorText(error)}`}
        </p>
      </div>
      <Button size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        Réessayer
      </Button>
    </div>
  );
}

/** Card surface: tone step on the ground (no border, no shadow), radius from the token. */
export function Card({
  className,
  children,
  as: El = "div",
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <El className={cn("rounded-card bg-surface", className)} {...rest}>
      {children}
    </El>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)} aria-labelledby={id}>
      <SectionHeader title={<span id={id}>{title}</span>} description={description} action={action} />
      {children}
    </section>
  );
}

/** Label/value pairs. Values are right-aligned on mobile, a two-column grid from sm up. */
export function DetailList({
  items,
  className,
}: {
  items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-1 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div
          key={i}
          className="flex min-h-11 items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0 sm:flex-col sm:items-start sm:justify-start sm:gap-0.5 sm:border-b-0 sm:py-2"
        >
          <dt className="shrink-0 text-sm text-fg-subtle">{it.label}</dt>
          <dd className="min-w-0 text-right text-base text-fg sm:text-left">
            {it.value}
            {it.hint ? <span className="block text-sm text-fg-subtle">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Muted inline callout for honest notes (estimates, legal notes). No color, no icon circle. */
export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("rounded-control bg-surface-2 px-3 py-2.5 text-sm text-fg-muted", className)}>{children}</p>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton shape="card" className={className} />;
}

/** Dash for unknown values, muted. */
export function Unknown({ children = "Non précisé" }: { children?: React.ReactNode }) {
  return <span className="text-fg-subtle">{children}</span>;
}

/** Small neutral badge (text, never color-alone). */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "negative" | "positive" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "border-border-strong text-fg-muted",
        tone === "warning" && "border-warning/40 text-warning",
        tone === "negative" && "border-negative/40 text-negative",
        tone === "positive" && "border-positive/40 text-positive",
        tone === "accent" && "border-accent/40 text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Parse a fr-CA decimal ("4,79") for client-side validation. */
export function parseDecimalFr(s: string): number | null {
  const t = s.replace(/[\s  %]/g, "").replace(",", ".");
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function decimalToFr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n).replace(".", ",");
}

/** Empty string → null (clears the field), otherwise trimmed text. */
export const textOrNull = (s: string) => (s.trim() ? s.trim() : null);
