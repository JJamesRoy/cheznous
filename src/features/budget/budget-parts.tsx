"use client";

import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Button, ListGroup, Money, ProgressBar, Skeleton } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/format";
import { Card, fmtDateShort, Note, QueryError, Section } from "@/features/condo/ui";
import { monthShortFr } from "./history-chart";

/** "reste 120,00 $" / "dépassé de 30,00 $" — the sentence carries the state, color only reinforces it. */
export function RemainingText({
  budgetCents,
  spentCents,
  className,
}: {
  budgetCents: number;
  spentCents: number;
  className?: string;
}) {
  const diff = budgetCents - spentCents;
  return diff >= 0 ? (
    <span className={cn("text-fg-muted", className)}>
      reste <Money cents={diff} />
    </span>
  ) : (
    <span className={cn("text-negative", className)}>
      dépassé de <Money cents={-diff} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

export function PayPeriodsView({ month }: { month: string }) {
  const q = useOp("budget.payPeriods", { month });

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton shape="card" className="h-[76px]" />
        <Skeleton shape="card" className="h-[76px]" />
      </div>
    );
  }
  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} what="les périodes de paie" />;
  const data = q.data;
  if (!data.configured) {
    return (
      <Card className="flex flex-col items-start gap-3 p-4">
        <p className="text-base text-fg-muted">
          Vous êtes payés aux deux semaines ? Ajoute ta date de paie dans Réglages : le budget du mois sera réparti
          sur chaque période de paie (deux ou trois selon le mois).
        </p>
        <Button asChild size="sm">
          <Link href="/reglages">
            Ajouter ma date de paie
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.note ? (
        <p className="rounded-card bg-surface px-4 py-3 text-base text-fg">
          <span className="font-medium">Mois à trois paies.</span>{" "}
          <span className="text-fg-muted">{data.note}</span>
        </p>
      ) : null}
      <ListGroup as="ul" aria-label="Périodes de paie">
        {data.periods.map((p) => {
          const last = addDays(p.endExclusive, -1);
          return (
            <li key={p.payday} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-medium text-fg">{p.label}</span>
                  <span className="text-sm text-fg-subtle">
                    {fmtDateShort(p.start)} – {fmtDateShort(last)}
                  </span>
                </div>
                <span className="shrink-0 text-base">
                  <Money cents={p.spentCents} className="text-fg" />
                  {p.budgetCents > 0 ? (
                    <span className="text-fg-subtle">
                      {" "}
                      / <Money cents={p.budgetCents} />
                    </span>
                  ) : null}
                </span>
              </div>
              {p.budgetCents > 0 ? (
                <>
                  <ProgressBar
                    value={p.spentCents}
                    max={p.budgetCents}
                    label={`${p.label} : ${Math.round((p.spentCents / p.budgetCents) * 100)} % du budget de la période`}
                    valueText={`${formatMoney(p.spentCents)} sur ${formatMoney(p.budgetCents)}`}
                    size="sm"
                  />
                  <RemainingText budgetCents={p.budgetCents} spentCents={p.spentCents} className="text-sm" />
                </>
              ) : null}
            </li>
          );
        })}
      </ListGroup>
      <p className="text-sm text-fg-subtle">
        Selon les paies de {data.basedOn.name}. Budget par période = budget du mois ÷ {data.periods.length}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison with the previous month
// ---------------------------------------------------------------------------

export function Comparison({ month, compareMonth }: { month: string; compareMonth: string }) {
  const q = useOp("spending.summary", { month, compareMonth });
  const title = `Par rapport à ${monthShortFr(compareMonth)}.`;
  // Nothing to compare: the history chart above already says so.
  if (q.data && (!q.data.comparison || (q.data.period.totalCents === 0 && q.data.comparison.totalCents === 0))) return null;
  return (
    <Section title={`Comparé à ${monthLabelFr(compareMonth)}`} id="budget-compare">
      {q.isPending ? (
        <Skeleton shape="card" className="h-[236px]" />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="la comparaison" />
      ) : !q.data.comparison || (q.data.period.totalCents === 0 && q.data.comparison.totalCents === 0) ? (
        <Note>Aucune dépense partagée sur ces deux mois.</Note>
      ) : (
        <Card className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <span className="text-base text-fg-muted">Total</span>
            <span className="text-base">
              <Money cents={q.data.comparison.deltaCents} sign className="font-medium text-fg" />
              {q.data.comparison.deltaPct !== null ? (
                <span className="num text-fg-subtle">
                  {" "}
                  ({q.data.comparison.deltaPct > 0 ? "+" : ""}
                  {q.data.comparison.deltaPct.toLocaleString("fr-CA")} %)
                </span>
              ) : null}
            </span>
          </div>
          <ul aria-label={title}>
            {[...q.data.comparison.byCategory]
              .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
              .filter((d) => d.deltaCents !== 0)
              .slice(0, 5)
              .map((d) => (
                <li
                  key={d.categoryId ?? "none"}
                  className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base text-fg">{d.name}</span>
                    <span className="text-sm text-fg-subtle">
                      <Money cents={d.periodCents} /> contre <Money cents={d.comparisonCents} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <Money cents={d.deltaCents} sign className="text-base text-fg" />
                    <span className="text-xs text-fg-subtle">{d.deltaCents > 0 ? "de plus" : "de moins"}</span>
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

const monthLong = new Intl.DateTimeFormat("fr-CA", { month: "long", timeZone: "UTC" });
export function monthLabelFr(m: string): string {
  return monthLong.format(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)));
}

// ---------------------------------------------------------------------------
// Expenses list (category sheet)
// ---------------------------------------------------------------------------

export function CategoryExpenses({ categoryId, from, to, monthLabel }: { categoryId: string; from: string; to: string; monthLabel: string }) {
  const q = useOp("expenses.list", { category: categoryId, from, to, limit: 100 });
  return (
    <section className="flex flex-col gap-2" aria-labelledby="cat-exp">
      <h3 id="cat-exp" className="text-sm font-medium text-fg-muted">
        Dépenses de {monthLabel}
      </h3>
      {q.isPending ? (
        <Skeleton shape="card" className="h-[156px]" />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="les dépenses" />
      ) : q.data.expenses.length === 0 ? (
        <p className="text-base text-fg-subtle">Aucune dépense dans cette catégorie ce mois-ci.</p>
      ) : (
        <ListGroup as="ul">
          {q.data.expenses.map((e) => (
            <li key={e.id} className="flex min-h-[52px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 truncate text-base text-fg">
                  {e.isPrivate ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm text-fg-subtle">
                      <Lock aria-hidden className="size-3.5" />
                      Privé
                    </span>
                  ) : null}
                  <span className="truncate">{e.description}</span>
                </span>
                <span className="truncate text-sm text-fg-subtle">
                  {fmtDateShort(e.spentOn)} · {e.payer.name}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <Money cents={e.amountCents} className="text-base text-fg" />
                {e.refundedCents > 0 ? (
                  <span className="text-xs text-fg-subtle">
                    remb. <Money cents={e.refundedCents} />
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ListGroup>
      )}
      {q.data && q.data.total > q.data.expenses.length ? (
        <p className="text-sm text-fg-subtle">{q.data.total - q.data.expenses.length} dépenses de plus non affichées.</p>
      ) : null}
    </section>
  );
}
