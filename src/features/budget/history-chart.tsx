"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Money } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/format";
import { usePrivacy } from "@/lib/ui/privacy";

export type HistoryPoint = { month: string; spentCents: number; budgetCents: number };

const shortMonth = new Intl.DateTimeFormat("fr-CA", { month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("fr-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const monthDate = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
export const monthShortFr = (m: string) => shortMonth.format(monthDate(m)).replace(/\.$/, "");
export const monthLongFr = (m: string) => longMonth.format(monthDate(m));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean tick step (1, 2, 2.5, 5 × 10^n) so the top gridline lands on a round number. */
function niceMax(v: number): number {
  if (v <= 0) return 100_00;
  const raw = v / 2;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? 10 * pow;
  return step * 2;
}

function compactTick(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return `${(d / 1000).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} k$`;
  return `${Math.round(d)} $`;
}

/** Column path: 4px rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Six-month history: one column per month (spent; current month in the accent,
 * the rest neutral) and a 2px tick for that month's budget. Two series, one axis,
 * hairline baseline + one gridline, hover/focus readout, table view.
 */
export function HistoryChart({
  points,
  currentMonth,
  highlightMonth,
  compact = false,
  title,
}: {
  points: HistoryPoint[];
  /** Today's month (gets the accent). */
  currentMonth: string;
  /** Month being viewed on the page (gets a label underline). */
  highlightMonth?: string;
  compact?: boolean;
  title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { masked } = usePrivacy();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();

  const plotH = compact ? 88 : 132;
  const top = compact ? 8 : 22;
  const labelsH = 24;
  const axisW = masked || compact || points.every((p) => !p.spentCents && !p.budgetCents) ? 0 : 40;
  const H = top + plotH + labelsH;
  const hasBudget = points.some((p) => p.budgetCents > 0);
  const empty = points.every((p) => p.spentCents === 0 && p.budgetCents === 0);

  const max = useMemo(() => niceMax(Math.max(1, ...points.map((p) => Math.max(p.spentCents, p.budgetCents)))), [points]);
  const plotW = Math.max(0, width - axisW);
  const slot = points.length ? plotW / points.length : 0;
  const barW = Math.max(6, Math.min(24, slot * 0.42));
  const y = (c: number) => top + plotH - (Math.min(c, max) / max) * plotH;

  const activePoint = active === null ? null : points[active];
  const currentIndex = points.findIndex((p) => p.month === currentMonth);

  const describe = (p: HistoryPoint) => {
    const parts = [`${monthLongFr(p.month)} : ${formatMoney(p.spentCents)} dépensés`];
    if (p.budgetCents > 0) {
      const diff = p.budgetCents - p.spentCents;
      parts.push(`budget ${formatMoney(p.budgetCents)}`);
      parts.push(diff >= 0 ? `reste ${formatMoney(diff)}` : `dépassé de ${formatMoney(-diff)}`);
    }
    return parts.join(", ");
  };

  return (
    <figure className="flex flex-col gap-3" aria-labelledby={titleId}>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={titleId} className={cn(compact ? "sr-only" : "text-sm font-medium text-fg-muted")}>
          {title}
        </span>
        <span className="flex items-center gap-4 text-sm text-fg-subtle">
          {hasBudget ? (
            <span className="flex items-center gap-3" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-gray-9" />
                Dépensé
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-fg" />
                Budget
              </span>
            </span>
          ) : null}
          {!compact && !empty ? (
            <button
              type="button"
              onClick={() => setTable((t) => !t)}
              className="-mx-2 -my-2 inline-flex h-9 items-center rounded-control px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg md:h-8"
              aria-pressed={table}
            >
              {table ? "Graphique" : "Tableau"}
            </button>
          ) : null}
        </span>
      </figcaption>

      {table ? (
        <div className="overflow-hidden rounded-card bg-surface">
          <table className="w-full text-base">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border text-left text-sm text-fg-subtle">
                <th scope="col" className="px-3 py-2 font-normal">Mois</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Dépensé</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Budget</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal capitalize">{monthLongFr(p.month)}</th>
                  <td className="px-3 py-2 text-right"><Money cents={p.spentCents} /></td>
                  <td className="px-3 py-2 text-right">
                    {p.budgetCents > 0 ? <Money cents={p.budgetCents} /> : <span className="text-fg-subtle">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full" style={{ height: H }}>
          {width > 0 ? (
            <svg width={width} height={H} role="list" aria-label={title} className="block overflow-visible">
              {/* Recessive chrome: top gridline + baseline, solid hairlines. */}
              {!empty ? <line x1={axisW} x2={width} y1={top + 0.5} y2={top + 0.5} stroke="var(--border)" /> : null}
              <line x1={axisW} x2={width} y1={top + plotH + 0.5} y2={top + plotH + 0.5} stroke="var(--border-strong)" />
              {axisW > 0 ? (
                <g className="num" fill="var(--fg-subtle)" fontSize={12}>
                  <text x={0} y={top + 4}>{compactTick(max)}</text>
                  <text x={0} y={top + plotH + 4}>0</text>
                </g>
              ) : null}
              {points.map((p, i) => {
                const cx = axisW + slot * i + slot / 2;
                const x = cx - barW / 2;
                const by = y(p.spentCents);
                const isCurrent = i === currentIndex;
                const isActive = active === i;
                const isViewed = highlightMonth === p.month;
                return (
                  <g
                    key={p.month}
                    role="listitem"
                    tabIndex={compact ? -1 : 0}
                    aria-label={describe(p)}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive((a) => (a === i ? null : a))}
                    className="outline-none"
                  >
                    {/* Hit target: the whole slot, bigger than the mark. */}
                    <rect x={axisW + slot * i} y={0} width={slot} height={H} fill="transparent" />
                    {isActive ? (
                      <rect x={axisW + slot * i + 2} y={top - 6} width={slot - 4} height={plotH + 6} rx={6} fill="var(--surface-2)" />
                    ) : null}
                    <path
                      d={columnPath(x, by, barW, top + plotH - by)}
                      fill={isCurrent ? "var(--accent)" : "var(--gray-9)"}
                    />
                    {p.budgetCents > 0 ? (
                      <line
                        x1={x - 4}
                        x2={x + barW + 4}
                        y1={y(p.budgetCents)}
                        y2={y(p.budgetCents)}
                        stroke="var(--fg)"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    ) : null}
                    {isCurrent && !compact && !masked && p.spentCents > 0 ? (
                      <text
                        x={cx}
                        y={Math.min(by, p.budgetCents > 0 ? y(p.budgetCents) : by) - 8}
                        textAnchor="middle"
                        fontSize={12}
                        fill="var(--fg-muted)"
                        className="num"
                      >
                        {formatMoney(p.spentCents, { round: true })}
                      </text>
                    ) : null}
                    <text
                      x={cx}
                      y={H - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fill={isViewed ? "var(--fg)" : "var(--fg-subtle)"}
                      fontWeight={isViewed ? 500 : 400}
                    >
                      {monthShortFr(p.month)}
                    </text>
                    {/* Focus ring for keyboard users. */}
                    <rect
                      x={axisW + slot * i + 1}
                      y={1}
                      width={Math.max(0, slot - 2)}
                      height={H - 2}
                      rx={6}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      className="opacity-0 [g:focus-visible>&]:opacity-100"
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}
          {empty ? (
            <p className="absolute inset-x-0 text-center text-base text-fg-muted" style={{ top: top + plotH / 2 - 10 }}>
              Aucune dépense partagée sur ces 6 mois.
            </p>
          ) : null}
          {activePoint && width > 0 && !compact && !empty ? (
            <Readout
              point={activePoint}
              left={Math.min(Math.max(axisW + slot * (active ?? 0) + slot / 2, 90), width - 90)}
            />
          ) : null}
        </div>
      )}
    </figure>
  );
}

function Readout({ point, left }: { point: HistoryPoint; left: number }) {
  const diff = point.budgetCents - point.spentCents;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-2 z-10 flex w-[180px] -translate-x-1/2 -translate-y-full flex-col gap-1 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm shadow-float"
      style={{ left }}
    >
      <span className="text-fg-subtle capitalize">{monthLongFr(point.month)}</span>
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-fg-muted">
          <span className="h-0.5 w-2.5 rounded-full bg-gray-9" />
          Dépensé
        </span>
        <Money cents={point.spentCents} className="font-medium text-fg" />
      </span>
      {point.budgetCents > 0 ? (
        <>
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className="h-0.5 w-2.5 rounded-full bg-fg" />
              Budget
            </span>
            <Money cents={point.budgetCents} className="font-medium text-fg" />
          </span>
          <span className="text-fg-subtle">
            {diff >= 0 ? "Reste " : "Dépassé de "}
            <Money cents={Math.abs(diff)} />
          </span>
        </>
      ) : null}
    </div>
  );
}
