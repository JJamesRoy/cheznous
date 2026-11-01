"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Plus, Repeat } from "lucide-react";
import { useCallback, useState } from "react";
import { PageHeader } from "@/components/shell";
import { Button, EmptyState, IconButton, Kbd, ListGroup, Money, ProgressBar, Row, SegmentedControl, Skeleton } from "@/components/ui";
import { addMonths, formatMonthFr } from "@/domain/dates";
import { useSession } from "@/features/app/session";
import { useQuickAdd } from "@/features/app/quick-add";
import { RecurringSheet } from "@/features/expenses/recurring-sheet";
import { Card, QueryError, Section } from "@/features/condo/ui";
import type { OpOutput } from "@/lib/data/api";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/format";
import { useHotkeys } from "@/lib/ui/use-hotkeys";
import { useIsDesktop } from "@/lib/ui/use-media-query";
import { Comparison, monthLabelFr, PayPeriodsView, RemainingText } from "./budget-parts";
import { CategorySheet, type BudgetLine } from "./category-sheet";
import { HistoryChart } from "./history-chart";
import { AiInsights } from "./ai-insights";

type Budget = OpOutput<"budget.get">;
type Line = Budget["lines"][number];
export type Scope = "household" | "personal";

export function BudgetScreen() {
  const session = useSession();
  const [month, setMonth] = useState(session.month);
  const [scope, setScope] = useState<Scope>("household");
  const [modeState, setMode] = useState<"month" | "pay">("month");
  // Pay periods are a household view (shared spending by pay cycle).
  const mode = scope === "personal" ? "month" : modeState;
  const [sheet, setSheet] = useState<{ line: BudgetLine | null } | null>(null);
  const desktop = useIsDesktop();
  const personal = scope === "personal";
  const q = useOp("budget.get", { month, scope }, { placeholderData: (prev) => prev });

  const go = useCallback((n: number) => setMonth((m) => addMonths(m, n)), []);
  useHotkeys(
    [
      {
        keys: "left",
        preventDefault: false,
        handler: (e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[role=radiogroup],[role=slider],[role=dialog],[role=menu]")) return;
          go(-1);
        },
      },
      {
        keys: "right",
        preventDefault: false,
        handler: (e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[role=radiogroup],[role=slider],[role=dialog],[role=menu]")) return;
          go(1);
        },
      },
    ],
    { enabled: desktop && !sheet },
  );

  const data = q.data;
  const stale = q.isPlaceholderData;
  const noBudget = data ? data.totals.budgetCents === 0 : false;
  const visibleCategories = session.categories.filter((c) => !c.archived);

  return (
    <div className="flex flex-col gap-8 pb-8">
      <PageHeader
        title="Budget"
        description={personal ? "Tes dépenses perso (privées), catégorie par catégorie. Toi seul·e les vois." : "Vos dépenses partagées, catégorie par catégorie."}
        className="pb-0"
      />

      <SegmentedControl
        aria-label="Budget du foyer ou budget perso"
        value={scope}
        onValueChange={setScope}
        fill={!desktop}
        className="sm:w-auto sm:self-start"
        options={[
          { value: "household", label: "Foyer" },
          { value: "personal", label: "Perso" },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MonthSwitcher month={month} onPrev={() => go(-1)} onNext={() => go(1)} isCurrent={month === session.month} onToday={() => setMonth(session.month)} />
        {personal ? null : (
          <SegmentedControl
            aria-label="Vue du budget"
            value={mode}
            onValueChange={setMode}
            fill={!desktop}
            className="sm:w-auto"
            options={[
              { value: "month", label: "Mois" },
              { value: "pay", label: "Périodes de paie" },
            ]}
          />
        )}
      </div>

      {q.isPending ? (
        <BudgetSkeleton />
      ) : q.error && !data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="le budget" />
      ) : data ? (
        <div className={cn("flex flex-col gap-8 transition-opacity duration-[220ms]", stale && "opacity-60")} aria-busy={stale}>
          {noBudget ? (
            <EmptyState
              message={
                personal
                  ? `Aucun budget perso pour ${formatMonthFr(month)}. Fixe un montant par catégorie pour tes dépenses à toi (gym, vêtements, sorties…).`
                  : `Aucun budget pour ${formatMonthFr(month)}. Fixe un montant par catégorie pour suivre ce qui reste à dépenser.`
              }
              action={
                <Button variant="primary" onClick={() => setSheet({ line: null })}>
                  {personal ? "Définir mon budget perso" : "Définir mon premier budget"}
                </Button>
              }
            />
          ) : (
            <Totals data={data} day={Number(session.today.slice(8, 10))} />
          )}

          {personal ? <PersonalExpenses /> : null}

          {mode === "pay" ? (
            <Section title="Par période de paie" id="budget-pay">
              <PayPeriodsView month={month} />
            </Section>
          ) : null}

          {noBudget && data.totals.spentCents === 0 && data.totals.previousSpentCents === 0 ? null : (
          <CategoryGroups
            data={data}
            onOpen={(l) => setSheet({ line: { categoryId: l.categoryId, name: l.name, kind: l.kind, budgetCents: l.budgetCents, spentCents: l.spentCents } })}
            previousLabel={monthLabelFr(addMonths(month, -1))}
            showProjection={data.isCurrentMonth && Number(session.today.slice(8, 10)) >= PROJECTION_MIN_DAY}
          />
          )}

          {mode === "month" ? (
            <>
              <History month={month} currentMonth={session.month} scope={scope} />
              {personal ? null : <Comparison month={month} compareMonth={addMonths(month, -1)} />}
            </>
          ) : null}

          <AiInsights />
        </div>
      ) : null}

      <CategorySheet
        open={sheet !== null}
        onOpenChange={(o) => !o && setSheet(null)}
        line={sheet?.line ?? null}
        month={month}
        currentMonth={session.month}
        categories={visibleCategories}
        scope={scope}
      />
    </div>
  );
}

function MonthSwitcher({
  month,
  onPrev,
  onNext,
  isCurrent,
  onToday,
}: {
  month: string;
  onPrev: () => void;
  onNext: () => void;
  isCurrent: boolean;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-1 sm:justify-start">
      <IconButton label="Mois précédent" onClick={onPrev}>
        <ChevronLeft aria-hidden />
      </IconButton>
      <h2 className="min-w-40 text-center text-md font-semibold first-letter:uppercase" aria-live="polite">
        {formatMonthFr(month)}
      </h2>
      <IconButton label="Mois suivant" onClick={onNext}>
        <ChevronRight aria-hidden />
      </IconButton>
      {!isCurrent ? (
        <Button variant="ghost" size="sm" onClick={onToday} className="hidden sm:inline-flex">
          Revenir au mois courant
        </Button>
      ) : (
        <span className="ml-2 hidden items-center gap-1 text-sm text-fg-subtle lg:flex" aria-hidden>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </span>
      )}
    </div>
  );
}

/** A linear projection from the first few days of a month is noise: wait for a week of data. */
const PROJECTION_MIN_DAY = 7;

function Totals({ data, day }: { data: Budget; day: number }) {
  const t = data.totals;
  const over = t.remainingCents < 0;
  const reliable = day >= PROJECTION_MIN_DAY;
  const projectedOver = data.isCurrentMonth && reliable && t.projectedCents > t.budgetCents;
  return (
    <Card as="section" aria-labelledby="budget-total" className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="budget-total" className="text-sm text-fg-muted">
          {over ? "Dépassé de" : data.isCurrentMonth ? "Reste à dépenser" : "Reste"}
        </h2>
        <Money
          cents={Math.abs(t.remainingCents)}
          animate
          className={cn("text-2xl font-semibold", over ? "text-negative" : "text-fg")}
        />
        <p className="text-base text-fg-muted">
          <Money cents={t.spentCents} animate className="text-fg" /> dépensés sur <Money cents={t.budgetCents} animate />
        </p>
      </div>
      <ProgressBar
        value={t.spentCents}
        max={t.budgetCents}
        tone={t.ratio > 1 ? "negative" : t.ratio >= 0.85 ? "warning" : "accent"}
        label={`Budget du mois : ${Math.round(t.ratio * 100)} % utilisé`}
        valueText={`${formatMoney(t.spentCents)} sur ${formatMoney(t.budgetCents)}`}
      />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:flex sm:flex-wrap sm:gap-x-10">
        {data.isCurrentMonth ? (
          <div className="col-span-2 flex flex-col">
            <dt className="text-sm text-fg-subtle">Projection fin de mois</dt>
            {reliable ? (
              <dd className={cn("text-lg font-semibold", projectedOver ? "text-warning" : "text-fg")}>
                <Money cents={t.projectedCents} animate />
              </dd>
            ) : (
              <dd className="text-base text-fg-muted">Disponible dès le {PROJECTION_MIN_DAY} du mois</dd>
            )}
            {projectedOver ? (
              <dd className="text-sm text-warning">
                au rythme actuel, <Money cents={t.projectedCents - t.budgetCents} /> au-delà du budget
              </dd>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col">
          <dt className="text-sm text-fg-subtle">Fixes</dt>
          <dd className="text-lg font-semibold text-fg">
            <Money cents={t.fixedSpentCents} animate />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm text-fg-subtle">Variables</dt>
          <dd className="text-lg font-semibold text-fg">
            <Money cents={t.variableSpentCents} animate />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function CategoryGroups({
  data,
  onOpen,
  previousLabel,
  showProjection,
}: {
  data: Budget;
  onOpen: (l: Line) => void;
  previousLabel: string;
  showProjection: boolean;
}) {
  const groups = [
    { kind: "fixed" as const, title: "Fixes" },
    { kind: "variable" as const, title: "Variables" },
  ];
  return (
    <>
      {groups.map((g) => {
        const all = data.lines.filter((l) => l.kind === g.kind);
        // Categories with neither a budget nor spending (this month or last) fold into one line.
        const idle = all.filter((l) => !l.budgetCents && !l.spentCents && !l.previousCents);
        const lines = all.filter((l) => !idle.includes(l));
        if (!all.length) return null;
        const budget = lines.reduce((s, l) => s + (l.budgetCents ?? 0), 0);
        const spent = lines.reduce((s, l) => s + l.spentCents, 0);
        return (
          <Section
            key={g.kind}
            id={`budget-${g.kind}`}
            title={g.title}
            action={
              <span className="text-sm text-fg-subtle">
                <Money cents={spent} />
                {budget > 0 ? (
                  <>
                    {" "}
                    / <Money cents={budget} />
                  </>
                ) : null}
              </span>
            }
          >
            <ListGroup as="ul" aria-label={`Catégories ${g.title.toLowerCase()}`}>
              {lines.map((l) => (
                <li key={l.categoryId}>
                  <CategoryRow line={l} onOpen={() => onOpen(l)} previousLabel={previousLabel} showProjection={showProjection} />
                </li>
              ))}
              {idle.length ? (
                <li>
                  <IdleCategories lines={idle} onOpen={onOpen} />
                </li>
              ) : null}
            </ListGroup>
          </Section>
        );
      })}
      {data.uncategorizedCents > 0 ? (
        <Card className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-base text-fg">Sans catégorie</span>
            <Link href="/depenses" className="text-sm text-fg-subtle underline-offset-2 hover:text-fg hover:underline">
              Classe-les dans Dépenses
            </Link>
          </span>
          <Money cents={data.uncategorizedCents} className="text-base text-fg" />
        </Card>
      ) : null}
    </>
  );
}

function IdleCategories({ lines, onOpen }: { lines: Line[]; onOpen: (l: Line) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-fg-subtle hover:bg-surface-2 hover:text-fg focus-visible:-outline-offset-2"
      >
        <span className="min-w-0 truncate">
          {lines.length} sans budget ni dépense · {lines.map((l) => l.name).join(", ")}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform duration-[220ms]", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="border-t border-border">
          {lines.map((l) => (
            <li key={l.categoryId}>
              <button
                type="button"
                onClick={() => onOpen(l)}
                className="pressable flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-4 py-2 text-left text-base text-fg last:border-b-0 hover:bg-surface-2 focus-visible:-outline-offset-2 [li:last-child>&]:border-b-0"
              >
                <span className="truncate">{l.name}</span>
                <span className="shrink-0 text-sm text-fg-subtle">Définir un budget</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CategoryRow({
  line: l,
  onOpen,
  previousLabel,
  showProjection,
}: {
  line: Line;
  onOpen: () => void;
  previousLabel: string;
  showProjection: boolean;
}) {
  const has = l.budgetCents !== null && l.budgetCents > 0;
  const reached = has && l.spentCents === l.budgetCents;
  const atRisk = has && l.state === "warning" && !reached;
  const projectionOver = showProjection && l.kind === "variable" && has && l.state !== "over" && l.projectedCents > l.budgetCents!;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable flex w-full flex-col gap-2 border-b border-border px-4 py-3 text-left hover:bg-surface-2 active:bg-surface-pressed focus-visible:-outline-offset-2 [li:last-child>&]:border-b-0"
    >
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className="truncate text-base text-fg">{l.name}</span>
        <span className="shrink-0 text-base">
          <Money cents={l.spentCents} className="text-fg" />
          {has ? (
            <span className="text-fg-subtle">
              {" "}
              / <Money cents={l.budgetCents!} />
            </span>
          ) : null}
        </span>
      </span>
      {has ? (
        <ProgressBar
          value={l.spentCents}
          max={l.budgetCents!}
          size="sm"
          tone={l.state === "over" ? "negative" : atRisk ? "warning" : "neutral"}
          // Rows that are fine stay grey: colour is reserved for rows at risk.
          className={l.state === "over" || atRisk ? undefined : "[&>*]:!bg-gray-9"}
          label={`${l.name} : ${Math.round(l.ratio * 100)} % du budget`}
          valueText={`${formatMoney(l.spentCents)} sur ${formatMoney(l.budgetCents!)}`}
        />
      ) : null}
      <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        {!has ? (
          <span className="text-fg-subtle">Aucun budget · Définir</span>
        ) : reached ? (
          <span className="text-fg-muted">{l.kind === "fixed" ? "payé" : "budget atteint"}</span>
        ) : atRisk ? (
          <span className="text-warning">
            presque atteint · reste <Money cents={l.remainingCents ?? 0} />
          </span>
        ) : projectionOver ? (
          <span className="text-warning">
            à ce rythme, <Money cents={l.projectedCents} round /> d&apos;ici la fin du mois
          </span>
        ) : (
          <RemainingText budgetCents={l.budgetCents!} spentCents={l.spentCents} />
        )}
        <span className="text-fg-subtle">
          {l.deltaCents === 0 ? (
            l.spentCents ? <>comme en {previousLabel}</> : null
          ) : (
            <>
              <Money cents={l.deltaCents} sign round /> vs {previousLabel}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** Personal budget: add a one-off private expense, or manage private recurring ones (gym…). */
function PersonalExpenses() {
  const quickAdd = useQuickAdd();
  const [recurring, setRecurring] = useState<null | "list" | "expense">(null);
  const q = useOp("recurring.list", { isPrivate: true });
  const rules = q.data?.rules ?? [];
  return (
    <Section
      title="Mes dépenses perso"
      id="budget-perso"
      description="Privées : payées par toi, jamais partagées, invisibles pour ton ou ta partenaire."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => quickAdd.open("expense", { isPrivate: true })}>
            <Plus aria-hidden /> Dépense perso
          </Button>
          <Button onClick={() => setRecurring("expense")}>
            <Repeat aria-hidden /> Dépense perso récurrente
          </Button>
        </div>
        {q.isPending ? (
          <Skeleton shape="card" className="h-[52px]" />
        ) : rules.length ? (
          <ListGroup as="ul" aria-label="Mes récurrences perso">
            {rules.map((r) => (
              <li key={r.id}>
                <Row
                  onClick={() => setRecurring("list")}
                  title={
                    <span className="flex items-center gap-1.5">
                      <Lock aria-hidden className="size-3.5 text-fg-subtle" />
                      {r.title}
                    </span>
                  }
                  description={[r.frequencyLabel, r.next ? `prochaine ${r.next.relative}` : null, r.autoCreate ? "ajout auto" : null].filter(Boolean).join(" · ")}
                  trailing={r.amountCents !== null ? <Money cents={r.amountCents} className="text-base text-fg" /> : null}
                />
              </li>
            ))}
          </ListGroup>
        ) : (
          <p className="text-sm text-fg-subtle">Aucune récurrence perso. Ajoute ton gym ou tes abonnements : ils s&apos;ajouteront tout seuls à ton budget perso.</p>
        )}
      </div>
      <RecurringSheet open={recurring !== null} onOpenChange={(o) => !o && setRecurring(null)} startWith={recurring === "expense" ? "expense" : "list"} personal />
    </Section>
  );
}

function History({ month, currentMonth, scope }: { month: string; currentMonth: string; scope: Scope }) {
  const q = useOp("budget.history", { months: 6, scope });
  return (
    <Section title="6 derniers mois" id="budget-history">
      <Card className="p-4 sm:p-5">
        {q.isPending ? (
          <Skeleton className="h-[206px]" />
        ) : q.error ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} what="l'historique" className="bg-transparent p-0" />
        ) : (
          <HistoryChart
            title={scope === "personal" ? "Dépenses perso par mois et budget du mois" : "Dépenses partagées par mois et budget du mois"}
            points={q.data.months}
            currentMonth={currentMonth}
            highlightMonth={month}
          />
        )}
      </Card>
    </Section>
  );
}

function BudgetSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy aria-label="Chargement du budget">
      <Skeleton shape="card" className="h-[214px]" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[18px] w-24" />
        <Skeleton shape="card" className="h-[300px]" />
      </div>
    </div>
  );
}
