"use client";

import { useState } from "react";
import { Button, Field, Money, MoneyInput, ProgressBar, Select, Sheet, SheetFooter, Skeleton } from "@/components/ui";
import { addDays, addMonths, formatMonthFr, monthRange } from "@/domain/dates";
import { useOp, useOpMutation } from "@/lib/data/query";
import { centsToInput, formatMoney } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { QueryError } from "@/features/condo/ui";
import { CategoryExpenses, RemainingText } from "./budget-parts";
import { HistoryChart } from "./history-chart";

export type BudgetLine = {
  categoryId: string;
  name: string;
  kind: "fixed" | "variable";
  budgetCents: number | null;
  spentCents: number;
};

/**
 * Category detail: set the monthly budget (applies from the viewed month on),
 * this month's expenses and a 6-month mini history. With `line === null` and
 * `pickCategory`, it's the "first budget" flow (choose a category first).
 */
export function CategorySheet({
  open,
  onOpenChange,
  line,
  month,
  currentMonth,
  categories,
  scope = "household",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: BudgetLine | null;
  month: string;
  currentMonth: string;
  /** When set (first-budget flow), the person picks the category. */
  categories?: { id: string; name: string }[];
  scope?: "household" | "personal";
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={line ? line.name : "Définir un budget"}
      description={line ? (line.kind === "fixed" ? "Dépense fixe" : "Dépense variable") : "Choisis une catégorie et un montant mensuel."}
      desktop="panel"
    >
      {open ? (
        <CategorySheetBody
          key={line?.categoryId ?? "new"}
          line={line}
          month={month}
          currentMonth={currentMonth}
          categories={categories}
          scope={scope}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Sheet>
  );
}

function CategorySheetBody({
  line,
  month,
  currentMonth,
  categories,
  scope,
  onDone,
}: {
  line: BudgetLine | null;
  month: string;
  currentMonth: string;
  categories?: { id: string; name: string }[];
  scope: "household" | "personal";
  onDone: () => void;
}) {
  const [categoryId, setCategoryId] = useState(line?.categoryId ?? "");
  const [text, setText] = useState(centsToInput(line?.budgetCents ?? null));
  const [cents, setCents] = useState<number | null>(line?.budgetCents ?? null);
  const [error, setError] = useState<string | null>(null);
  const set = useOpMutation("budget.set");
  const monthLabel = formatMonthFr(month);
  const { start, endExclusive } = monthRange(month);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryId) return setError("Choisis une catégorie.");
    if (cents === null) return setError("Entre un montant (0 pour retirer le budget).");
    setError(null);
    try {
      await set.mutateAsync({ category: categoryId, amount: { cents }, fromMonth: month, scope });
      haptic("success");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {line && line.budgetCents ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 text-base">
            <span>
              <Money cents={line.spentCents} className="font-medium text-fg" />
              <span className="text-fg-subtle">
                {" "}
                sur <Money cents={line.budgetCents} />
              </span>
            </span>
            <RemainingText budgetCents={line.budgetCents} spentCents={line.spentCents} className="text-sm" />
          </div>
          <ProgressBar
            value={line.spentCents}
            max={line.budgetCents}
            label={`${line.name} : ${Math.round((line.spentCents / line.budgetCents) * 100)} % du budget`}
            valueText={`${formatMoney(line.spentCents)} sur ${formatMoney(line.budgetCents)}`}
          />
        </div>
      ) : null}

      <form onSubmit={save} className="flex flex-col gap-4" id="budget-form">
        {!line && categories ? (
          <Field label="Catégorie" required>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choisir une catégorie…"
            />
          </Field>
        ) : null}
        <Field
          label={scope === "personal" ? "Budget perso mensuel" : "Budget mensuel"}
          hint={`S'applique à partir de ${monthLabel} et pour les mois suivants, jusqu'à ce que tu le changes. Les mois passés gardent leur budget.`}
          error={error}
        >
          <MoneyInput
            value={text}
            onValueChange={(t, c) => {
              setText(t);
              setCents(c);
            }}
            autoFocus={!line?.budgetCents}
          />
        </Field>
        <SheetFooter>
          {line?.budgetCents ? (
            <Button
              variant="ghost"
              className="text-fg-muted md:mr-auto"
              disabled={set.isPending}
              onClick={() => {
                setText("0");
                setCents(0);
              }}
            >
              Retirer le budget
            </Button>
          ) : null}
          <Button type="submit" variant="primary" loading={set.isPending}>
            Enregistrer
          </Button>
        </SheetFooter>
      </form>

      {line ? (
        <>
          <MiniHistory categoryId={line.categoryId} currentMonth={currentMonth} viewedMonth={month} scope={scope} />
          <CategoryExpenses categoryId={line.categoryId} from={start} to={addDays(endExclusive, -1)} monthLabel={monthLabel} onlyPrivate={scope === "personal"} />
        </>
      ) : null}
    </div>
  );
}

function MiniHistory({ categoryId, currentMonth, viewedMonth, scope }: { categoryId: string; currentMonth: string; viewedMonth: string; scope: "household" | "personal" }) {
  const q = useOp("budget.history", { months: 6, category: categoryId, scope });
  return (
    <section className="flex flex-col gap-2" aria-labelledby="cat-hist">
      <h3 id="cat-hist" className="text-sm font-medium text-fg-muted">
        6 derniers mois
      </h3>
      {q.isPending ? (
        <Skeleton shape="card" className="h-[150px]" />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="l'historique" />
      ) : (
        <HistoryChart
          compact
          title={`Dépenses des 6 derniers mois, de ${formatMonthFr(addMonths(currentMonth, -5))} à ${formatMonthFr(currentMonth)}`}
          points={q.data.months}
          currentMonth={currentMonth}
          highlightMonth={viewedMonth}
        />
      )}
    </section>
  );
}
