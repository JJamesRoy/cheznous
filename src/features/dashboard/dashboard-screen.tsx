"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { ArrowRight, ChevronRight, Repeat } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell";
import {
  Avatar,
  Button,
  Checkbox,
  EmptyState,
  ListGroup,
  Money,
  ProgressBar,
  PullToRefresh,
  Row,
  SectionHeader,
  Skeleton,
  toast,
  undoable,
} from "@/components/ui";
import { formatDateShortFr, formatMonthFr } from "@/domain/dates";
import { ApiError, callOp, type OpOutput } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { useQuickAdd } from "@/features/app/quick-add";
import { useSession } from "@/features/app/session";
import { BalanceSentence } from "@/features/balances/balance-sentence";
import { MonthLanes } from "@/features/balances/month-lanes";
import { RecurringSheet } from "@/features/expenses/recurring-sheet";

type Dashboard = OpOutput<"dashboard.get">;

const ease = [0.23, 1, 0.32, 1] as const;

export function DashboardScreen() {
  const q = useOp("dashboard.get", {});
  const qc = useQueryClient();
  const [recurring, setRecurring] = useState<null | "list" | "bill">(null);

  return (
    <>
      <PageHeader title="Accueil" />
      <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["op"] })}>
        {q.data ? (
          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}>
            <DashboardContent data={q.data} onRecurring={setRecurring} />
          </m.div>
        ) : q.error ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-card bg-surface p-5 text-base text-fg-muted">
            {q.error.isNetwork ? "Hors ligne : l'accueil n'a pas encore été chargé sur cet appareil." : q.error.message}
            <Button size="sm" onClick={() => q.refetch()}>
              Réessayer
            </Button>
          </div>
        ) : (
          <DashboardSkeleton />
        )}
      </PullToRefresh>
      <RecurringSheet open={recurring !== null} onOpenChange={(o) => !o && setRecurring(null)} startWith={recurring === "bill" ? "bill" : "list"} />
    </>
  );
}

function DashboardContent({ data, onRecurring }: { data: Dashboard; onRecurring: (m: "list" | "bill") => void }) {
  const solo = data.household.memberCount < 2;
  const b = data.balance;
  return (
    <div className="flex flex-col gap-8">
      <Link href="/balances" className="group -m-2 flex flex-col gap-2 rounded-card p-2 focus-visible:outline-offset-0" aria-label={`${b.sentence}. Voir les balances`}>
        <span className="text-sm text-fg-muted">Balance</span>
        <BalanceSentence kind={b.me.kind as "owed" | "owes" | "even"} amountCents={b.me.amountCents} partnerName={b.partner?.name ?? null} solo={solo} as="h2" />
        <span className="flex items-center gap-1 text-sm text-fg-subtle group-hover:text-fg">
          {solo
            ? "Les balances apparaissent quand vous êtes deux"
            : b.activityCount
              ? `${b.activityCount} ${b.activityCount > 1 ? "mouvements" : "mouvement"} depuis le dernier règlement`
              : "Rien depuis le dernier règlement"}
          <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
      </Link>

      {solo || data.household.onboardingStep !== "done" ? (
        <div className="flex flex-col gap-2">
          {solo ? (
            <div className="flex flex-col gap-3 rounded-card bg-surface p-4 sm:flex-row sm:items-center md:p-5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-medium text-fg">Invite ton/ta partenaire</span>
                <span className="text-sm text-fg-muted">Partagez les dépenses, les listes et les tâches, chacun sur son téléphone.</span>
              </div>
              <Button asChild>
                <Link href="/reglages#partenaire">Inviter</Link>
              </Button>
            </div>
          ) : null}
          {data.household.onboardingStep !== "done" ? (
            <Link href="/bienvenue" className="inline-flex min-h-11 items-center gap-1 self-start text-base text-fg-muted hover:text-fg">
              Continuer la configuration <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-x-8">
        <div className="flex min-w-0 flex-col gap-8">
          <Block title="Ce mois-ci">{data.flags.hasExpenses ? <MonthLanes lanes={data.lanes} /> : <FirstExpense />}</Block>
          <BudgetBlock data={data} />
          <UpcomingBlock data={data} onRecurring={onRecurring} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <TasksBlock data={data} />
          <ListsBlock data={data} />
          <GoalsBlock data={data} />
        </div>
      </div>
    </div>
  );
}

function Block({ title, description, action, children, label }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="flex flex-col gap-3">
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </section>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-0.5 rounded-control px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg md:h-8">
      {children}
      <ChevronRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function FirstExpense() {
  const quickAdd = useQuickAdd();
  return (
    <EmptyState
      message="Ajoute votre première dépense : on calcule qui doit quoi, au cent près."
      action={
        <Button variant="primary" onClick={() => quickAdd.open("expense")}>
          Ajouter une dépense
        </Button>
      }
    />
  );
}

// ─── 1. Ce mois-ci ──────────────────────────────────────────────────────────

function BudgetBlock({ data }: { data: Dashboard }) {
  const mb = data.month_budget;
  const monthName = formatMonthFr(data.month).replace(/ \d{4}$/, "");
  if (!mb.hasBudget) {
    return (
      <Block title={`Budget de ${monthName}`}>
        <EmptyState
          message={
            mb.spentCents > 0 ? (
              <>
                <Money cents={mb.spentCents} className="text-fg" /> dépensés en {monthName}, sans budget pour comparer.
              </>
            ) : (
              `Aucun budget pour ${monthName}.`
            )
          }
          action={
            <Button variant="primary" asChild>
              <Link href="/budget">Définir un budget</Link>
            </Button>
          }
        />
      </Block>
    );
  }
  const over = mb.remainingCents < 0;
  const projectedOver = mb.projectedCents > mb.budgetCents;
  return (
    <Block title={`Budget de ${monthName}`} action={<HeaderLink href="/budget">Détails</HeaderLink>}>
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-base text-fg-muted">
            <Money cents={mb.spentCents} animate className="text-xl font-semibold text-fg" /> <span>sur</span> <Money cents={mb.budgetCents} />
          </p>
          <p className={cn("text-base", over ? "text-negative" : "text-fg-muted")}>
            {over ? (
              <>
                Dépassé de <Money cents={-mb.remainingCents} />
              </>
            ) : (
              <>
                Reste <Money cents={mb.remainingCents} className="text-fg" />
              </>
            )}
          </p>
        </div>
        <ProgressBar value={mb.spentCents} max={mb.budgetCents} tone="auto" label={`Budget de ${monthName}`} valueText={`${mb.spent} sur ${mb.budget}`} />
        {/* A projection from the first days of the month is noise; same rule as the Budget screen. */}
        {Number(data.today.slice(8, 10)) >= 7 ? (
          <p className={cn("text-sm", projectedOver ? "text-warning" : "text-fg-subtle")}>
            Fin du mois prévue : <Money cents={mb.projectedCents} />
            {projectedOver ? " · au-dessus du budget" : ""}
          </p>
        ) : null}
        {mb.watch.length ? (
          <ul className="-mx-4 mt-1 flex flex-col border-t border-border px-4 pt-2 md:-mx-5 md:px-5" aria-label="Catégories à surveiller">
            {mb.watch.map((w) => (
              <li key={w.name} className="flex min-h-10 items-center justify-between gap-3 text-base">
                <span className="truncate text-fg">{w.name}</span>
                <span className={cn("shrink-0 text-sm", w.state === "over" ? "text-negative" : "text-warning")}>
                  {w.state === "over" ? (
                    <>
                      Dépassé de <Money cents={-(w.remainingCents ?? 0)} />
                    </>
                  ) : (
                    <>
                      Reste <Money cents={w.remainingCents ?? 0} />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Block>
  );
}

// ─── 2. À venir ─────────────────────────────────────────────────────────────

function UpcomingBlock({ data, onRecurring }: { data: Dashboard; onRecurring: (m: "list" | "bill") => void }) {
  const recurringButton = (
    <Button size="sm" variant="ghost" onClick={() => onRecurring("list")}>
      <Repeat aria-hidden /> Récurrences
    </Button>
  );
  if (data.upcoming.length === 0) {
    return (
      <Block title="À venir" action={recurringButton}>
        <EmptyState
          message="Rien de prévu dans les 21 prochains jours."
          action={
            <Button variant="primary" onClick={() => onRecurring("bill")}>
              Ajouter une facture récurrente
            </Button>
          }
        />
      </Block>
    );
  }
  return (
    <Block
      title="À venir"
      description={
        data.upcomingTotalCents > 0 ? (
          <>
            <Money cents={data.upcomingTotalCents} /> d&apos;ici 21 jours
          </>
        ) : (
          "21 prochains jours"
        )
      }
      action={recurringButton}
    >
      <ListGroup as="ul" aria-label="À venir">
        {data.upcoming.map((u) => {
          const [day, month] = formatDateShortFr(u.date).split(" ");
          return (
            <li key={`${u.id}:${u.date}`}>
              <Row
                leading={
                  <span className="flex size-10 flex-col items-center justify-center rounded-inner bg-surface-2 leading-none" aria-hidden>
                    <span className="num text-base font-semibold text-fg">{day}</span>
                    <span className="text-xs text-fg-subtle">{month}</span>
                  </span>
                }
                title={u.title}
                description={relativeLabel(u.daysUntil)}
                trailing={u.amountCents !== null ? <Money cents={u.amountCents} className="text-base text-fg" /> : <span className="text-sm text-fg-subtle">À confirmer</span>}
              />
            </li>
          );
        })}
      </ListGroup>
    </Block>
  );
}

function relativeLabel(days: number) {
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  return `Dans ${days} jours`;
}

// ─── 3. Tâches de la semaine ────────────────────────────────────────────────

function TasksBlock({ data }: { data: Dashboard }) {
  const quickAdd = useQuickAdd();
  const session = useSession();
  const ids = session.household.members.map((m) => m.userId);
  const qc = useQueryClient();
  const [done, setDone] = useState<Set<string>>(new Set());
  const complete = useOpMutation("tasks.complete");
  const items = data.tasks.items;

  function check(task: (typeof items)[number]) {
    setDone((s) => new Set(s).add(task.id));
    haptic("success");
    complete.mutate(
      { id: task.id, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: (res) => {
          const recurring = Boolean(res.nextDueOn);
          if (recurring) {
            toast("Tâche faite", { description: `Prochaine fois : ${formatDateShortFr(res.nextDueOn!)}` });
          } else {
            undoable("Tâche terminée", async () => {
              await callOp("tasks.reopen", { id: task.id }).catch((e) => toast.error(e instanceof ApiError ? e.message : "Impossible d'annuler."));
              setDone((s) => {
                const n = new Set(s);
                n.delete(task.id);
                return n;
              });
              void qc.invalidateQueries({ queryKey: ["op"] });
            });
          }
        },
        onError: (e) => {
          setDone((s) => {
            const n = new Set(s);
            n.delete(task.id);
            return n;
          });
          toast.error(e.message);
        },
      },
    );
  }

  const visible = items.filter((t) => !t.completed);
  if (visible.length === 0) {
    return (
      <Block title="Tâches de la semaine">
        <EmptyState
          message="Rien à faire cette semaine."
          action={
            <Button variant="primary" onClick={() => quickAdd.open("task")}>
              Ajouter une tâche
            </Button>
          }
        />
      </Block>
    );
  }
  return (
    <Block
      title="Tâches de la semaine"
      action={<HeaderLink href="/taches">{data.tasks.more ? `${data.tasks.more} de plus` : "Toutes"}</HeaderLink>}
    >
      <ListGroup as="ul" aria-label="Tâches de la semaine">
        <AnimatePresence initial={false}>
          {visible.map((t) => {
            const isDone = done.has(t.id);
            return (
              <m.li
                key={t.id}
                layout
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.22, ease }}
                className="bg-surface pl-4"
              >
                <div className="cn-row-sep relative flex items-center gap-3 pr-4">
                <Checkbox
                  shape="round"
                  className="min-h-[52px] flex-1"
                  checked={isDone}
                  disabled={isDone}
                  strikeWhenChecked
                  onCheckedChange={(v) => v && check(t)}
                  label={t.title}
                  description={
                    t.due ? (
                      t.due.overdue ? (
                        <span className="text-negative">En retard · {t.due.label.replace(/ \d{4}$/, "")}</span>
                      ) : (
                        capitalize(t.due.relative)
                      )
                    ) : (
                      "Sans échéance"
                    )
                  }
                />
                {t.assignee ? (
                  <Avatar name={t.assignee.name} size="sm" tone={toneForMember(ids, t.assignee.userId).key} />
                ) : null}
                </div>
              </m.li>
            );
          })}
        </AnimatePresence>
      </ListGroup>
    </Block>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── 4. Listes ──────────────────────────────────────────────────────────────

function ListsBlock({ data }: { data: Dashboard }) {
  const quickAdd = useQuickAdd();
  const lists = data.shopping.lists;
  if (lists.length === 0) {
    return (
      <Block title="Listes">
        <EmptyState
          message="Toutes les listes sont vides."
          action={
            <Button variant="primary" onClick={() => quickAdd.open("item")}>
              Ajouter un article
            </Button>
          }
        />
      </Block>
    );
  }
  return (
    <Block title="Listes" action={<HeaderLink href="/listes">Toutes</HeaderLink>}>
      <ListGroup as="ul" aria-label="Listes">
        {lists.map((l) => (
          <li key={l.id}>
            <Row
              href={`/listes/${l.id}`}
              title={l.name}
              description={l.preview.join(", ")}
              trailing={
                <span className="num text-sm text-fg-muted">
                  {l.openCount} {l.openCount > 1 ? "articles" : "article"}
                </span>
              }
            />
          </li>
        ))}
      </ListGroup>
    </Block>
  );
}

// ─── 5. Objectifs ───────────────────────────────────────────────────────────

function GoalsBlock({ data }: { data: Dashboard }) {
  if (data.goals.length === 0) {
    return (
      <Block title="Objectifs">
        <EmptyState
          message="Un voyage, un fonds d'urgence, un remboursement anticipé : mettez de côté ensemble."
          action={
            <Button variant="primary" asChild>
              <Link href="/objectifs">Créer un objectif</Link>
            </Button>
          }
        />
      </Block>
    );
  }
  return (
    <Block title="Objectifs" action={<HeaderLink href="/objectifs">Tous</HeaderLink>}>
      <ul className="flex flex-col gap-4 rounded-card bg-surface p-4 md:p-5" aria-label="Objectifs">
        {data.goals.map((g) => (
          <li key={g.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Link href="/objectifs" className="min-w-0 truncate text-base text-fg hover:underline">
                {g.name}
              </Link>
              <span className="shrink-0 text-sm text-fg-muted">
                <Money cents={g.savedCents} className="text-fg" />
                {g.targetCents !== null ? (
                  <>
                    {" "}
                    sur <Money cents={g.targetCents} />
                  </>
                ) : null}
              </span>
            </div>
            {g.targetCents ? (
              <ProgressBar value={g.savedCents} max={g.targetCents} tone="accent" size="sm" label={g.name} valueText={`${g.saved} sur ${g.target}`} />
            ) : (
              <span className="text-sm text-fg-subtle">Sans cible</span>
            )}
          </li>
        ))}
      </ul>
    </Block>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy aria-label="Chargement de l'accueil">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[18px] w-16" />
        <Skeleton className="h-[38px] w-4/5 md:h-11" />
        <Skeleton className="h-[18px] w-56" />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <Skeleton shape="card" className="h-[284px] w-full" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[18px] w-24" />
            <Skeleton shape="card" className="h-36 w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[18px] w-40" />
            <Skeleton shape="card" className="h-[156px] w-full" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[18px] w-16" />
            <Skeleton shape="card" className="h-[104px] w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
