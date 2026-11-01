"use client";

import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Lock, Pencil, Plus, Repeat, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shell";
import {
  Avatar,
  Button,
  Chip,
  ChipGroup,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  ListGroup,
  Money,
  PullToRefresh,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  SwipeRow,
} from "@/components/ui";
import { addDays, addMonths, formatDateShortFr, formatMonthFr, monthRange } from "@/domain/dates";
import { callOp, type OpInput } from "@/lib/data/api";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { toneForMember } from "@/lib/ui/people";
import { useIsDesktop } from "@/lib/ui/use-media-query";
import { useQuickAdd } from "@/features/app/quick-add";
import { useMembers, useSession } from "@/features/app/session";
import { ExpenseDetailSheet, useDeleteExpense } from "./expense-detail-sheet";
import { RecurringSheet } from "./recurring-sheet";
import { dayLabel, splitLabel, type Expense } from "./shared";

const PAGE = 50;
const ALL = "__all";
type PayerFilter = "me" | "partner" | "joint";
type Sort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ExpensesScreen() {
  const session = useSession();
  const { me, partner, members } = useMembers();
  const quickAdd = useQuickAdd();
  const desktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const deleteExpense = useDeleteExpense();

  const [month, setMonth] = useState(session.month);
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim(), 200);
  const [category, setCategory] = useState<string | null>(null);
  const [payer, setPayer] = useState<PayerFilter | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("date_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editMode, setEditMode] = useState<"view" | "edit">("view");
  const searchRef = useRef<HTMLInputElement>(null);

  const detailId = params.get("d");
  const openDetail = (id: string, mode: "view" | "edit" = "view") => {
    setEditMode(mode);
    const p = new URLSearchParams(params.toString());
    p.set("d", id);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const closeDetail = () => {
    const p = new URLSearchParams(params.toString());
    p.delete("d");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // "/" focuses the search (capture phase: before the global "/" → ⌘K binding).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      e.stopPropagation();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const range = monthRange(month);
  const filters = useMemo(() => {
    const f: OpInput<"expenses.list"> = { sort };
    // Search looks through every month.
    if (!search) {
      f.from = range.start;
      f.to = addDays(range.endExclusive, -1);
    } else f.search = search;
    if (category) f.category = category;
    if (project) f.project = project;
    if (payer) f.payer = payer === "joint" ? "commun" : payer === "partner" && partner ? partner.userId : me.userId;
    return f;
  }, [sort, search, range.start, range.endExclusive, category, project, payer, partner, me.userId]);

  const list = useInfiniteQuery({
    queryKey: ["op", "expenses.list", { ...filters, page: PAGE }],
    queryFn: ({ pageParam, signal }) => callOp("expenses.list", { ...filters, limit: PAGE, offset: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((s, p) => s + p.expenses.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const expenses = useMemo(() => list.data?.pages.flatMap((p) => p.expenses) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const fullSum = useOp("expenses.list", { ...filters, limit: 500 }, { enabled: Boolean(list.hasNextPage) });
  const sumCents = list.hasNextPage ? fullSum.data?.sumCents : list.data?.pages.reduce((s, p) => s + p.sumCents, 0);

  const activeFilters = [category, payer, project].filter(Boolean).length;
  const clearFilters = () => {
    setCategory(null);
    setPayer(null);
    setProject(null);
    setSearchText("");
  };
  const detailInitial = expenses.find((e) => e.id === detailId) ?? null;
  const isCurrentMonth = month === session.month;
  const ids = members.map((m) => m.userId);

  const actions = (
    <>
      <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setRecurringOpen(true)}>
        <Repeat aria-hidden /> Récurrences
      </Button>
      <IconButton label="Récurrences" className="lg:hidden" onClick={() => setRecurringOpen(true)}>
        <Repeat aria-hidden />
      </IconButton>
      <Button variant="primary" size="sm" className="hidden lg:inline-flex" onClick={() => quickAdd.open("expense")}>
        <Plus aria-hidden /> Nouvelle dépense <Kbd className="ml-1">N</Kbd>
      </Button>
    </>
  );

  const monthSwitcher = (
    <div className="flex items-center gap-0.5">
      <IconButton label="Mois précédent" size="icon-sm" onClick={() => setMonth(addMonths(month, -1))} disabled={Boolean(search)}>
        <ChevronLeft aria-hidden />
      </IconButton>
      <span className={cn("num min-w-30 text-center text-base font-medium first-letter:uppercase", search ? "text-fg-subtle" : "text-fg")} aria-live="polite">
        {search ? "Tous les mois" : formatMonthFr(month)}
      </span>
      <IconButton label="Mois suivant" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} disabled={Boolean(search) || isCurrentMonth}>
        <ChevronRight aria-hidden />
      </IconButton>
    </div>
  );

  const searchField = (
    <Input
      ref={searchRef}
      type="search"
      value={searchText}
      onChange={(e) => setSearchText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && searchText) {
          e.stopPropagation();
          setSearchText("");
        }
      }}
      placeholder="Rechercher une dépense"
      aria-label="Rechercher une dépense"
      leading={<Search aria-hidden />}
      trailing={desktop && !searchText ? <Kbd>/</Kbd> : undefined}
    />
  );

  const categoryOptions = [{ value: ALL, label: "Toutes les catégories" }, ...session.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))];
  const payerOptions = [
    { value: ALL, label: "Tous les payeurs" },
    { value: "me", label: "Moi" },
    ...(partner ? [{ value: "partner", label: partner.displayName }] : []),
    { value: "joint", label: session.household.jointAccount.name || "Compte commun" },
  ];
  const projectOptions = [{ value: ALL, label: "Tous les projets" }, ...session.projects.map((p) => ({ value: p.id, label: p.name }))];

  const summary = (
    <p className="text-sm text-fg-muted" aria-live="polite">
      {list.data ? (
        <>
          <span className={desktop ? undefined : "sr-only"}>
            {total} {total > 1 ? "dépenses" : "dépense"}
          </span>
          {sumCents !== undefined ? (
            <>
              {desktop ? " · " : "Total "}
              <Money cents={sumCents} className="font-medium text-fg" />
            </>
          ) : null}
        </>
      ) : (
        " "
      )}
    </p>
  );

  const empty =
    list.data && expenses.length === 0 ? (
      activeFilters || search ? (
        <EmptyState message="Aucune dépense ne correspond à ces filtres." action={<Button onClick={clearFilters}>Effacer les filtres</Button>} />
      ) : (
        <EmptyState
          message={isCurrentMonth ? "Aucune dépense ce mois-ci." : `Aucune dépense en ${formatMonthFr(month)}.`}
          action={
            <Button variant="primary" onClick={() => quickAdd.open("expense", month !== session.month ? { spentOn: addDays(range.endExclusive, -1) } : undefined)}>
              Ajouter une dépense
            </Button>
          }
        />
      )
    ) : null;

  return (
    <>
      <PageHeader title="Dépenses" actions={actions} />

      {desktop ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">{searchField}</div>
            {monthSwitcher}
            <div className="w-48">
              <Select aria-label="Catégorie" value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? null : v)} options={categoryOptions} />
            </div>
            <div className="w-44">
              <Select aria-label="Payé par" value={payer ?? ALL} onValueChange={(v) => setPayer(v === ALL ? null : (v as PayerFilter))} options={payerOptions} />
            </div>
            {session.projects.length ? (
              <div className="w-44">
                <Select aria-label="Projet" value={project ?? ALL} onValueChange={(v) => setProject(v === ALL ? null : v)} options={projectOptions} />
              </div>
            ) : null}
            {activeFilters || search ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Effacer
              </Button>
            ) : null}
            <div className="ml-auto">{summary}</div>
          </div>
          {list.error && !list.data ? (
            <ErrorBlock message={list.error.message} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            <Skeleton shape="card" className="h-[420px] w-full" />
          ) : (
            empty ?? <ExpenseTable expenses={expenses} sort={sort} onSort={setSort} onOpen={(id) => openDetail(id)} today={session.today} />
          )}
        </div>
      ) : (
        <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["op", "expenses.list"] })}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchField}</div>
              <Button aria-label={activeFilters ? `Filtres (${activeFilters} actifs)` : "Filtres"} onClick={() => setFiltersOpen(true)} className="relative w-11 px-0">
                <SlidersHorizontal aria-hidden />
                {activeFilters ? <span className="num absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-primary text-xs text-primary-fg">{activeFilters}</span> : null}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              {monthSwitcher}
              {summary}
            </div>
            {activeFilters ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
                {category ? <FilterChip label={session.categories.find((c) => c.id === category)?.name ?? "Catégorie"} onClear={() => setCategory(null)} /> : null}
                {payer ? <FilterChip label={payerOptions.find((p) => p.value === payer)?.label ?? ""} onClear={() => setPayer(null)} /> : null}
                {project ? <FilterChip label={session.projects.find((p) => p.id === project)?.name ?? "Projet"} onClear={() => setProject(null)} /> : null}
              </div>
            ) : null}
            {list.error && !list.data ? (
              <ErrorBlock message={list.error.message} onRetry={() => list.refetch()} />
            ) : !list.data ? (
              <ListSkeleton />
            ) : (
              (empty ?? (
                <DayGroups
                  expenses={expenses}
                  today={session.today}
                  memberIds={ids}
                  grouped={sort.startsWith("date")}
                  onOpen={(id, mode) => openDetail(id, mode)}
                  onDelete={(e) => void deleteExpense(e)}
                />
              ))
            )}
          </div>
        </PullToRefresh>
      )}

      {list.hasNextPage ? (
        <div className="flex justify-center pt-4">
          <Button variant="ghost" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Charger plus
          </Button>
        </div>
      ) : null}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filtres">
        <div className="flex flex-col gap-5">
          <Field label="Catégorie">
            <Select value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? null : v)} options={categoryOptions} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Payé par</span>
            <ChipGroup aria-label="Payé par" value={payer ?? ALL} onValueChange={(v) => setPayer(v === ALL ? null : (v as PayerFilter))} options={payerOptions.map((o) => ({ ...o, label: o.value === ALL ? "Tous" : o.label }))} />
          </div>
          {session.projects.length ? (
            <Field label="Projet">
              <Select value={project ?? ALL} onValueChange={(v) => setProject(v === ALL ? null : v)} options={projectOptions} />
            </Field>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Trier par</span>
            <ChipGroup
              aria-label="Trier par"
              value={sort}
              onValueChange={setSort}
              options={[
                { value: "date_desc", label: "Plus récentes" },
                { value: "date_asc", label: "Plus anciennes" },
                { value: "amount_desc", label: "Montant décroissant" },
                { value: "amount_asc", label: "Montant croissant" },
              ]}
            />
          </div>
          <SheetFooter>
            <Button
              onClick={() => {
                setCategory(null);
                setPayer(null);
                setProject(null);
                setSort("date_desc");
              }}
            >
              Réinitialiser
            </Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              Voir {total} {total > 1 ? "dépenses" : "dépense"}
            </Button>
          </SheetFooter>
        </div>
      </Sheet>

      <ExpenseDetailSheet key={`${detailId}:${editMode}`} id={detailId} initial={detailInitial} initialMode={editMode} onClose={closeDetail} />
      <RecurringSheet open={recurringOpen} onOpenChange={setRecurringOpen} />
    </>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Chip pressed onClick={onClear} aria-label={`Retirer le filtre ${label}`}>
      {label}
      <X aria-hidden />
    </Chip>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card bg-surface p-5 text-base text-fg-muted">
      {message}
      <Button size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy aria-label="Chargement des dépenses">
      <Skeleton className="mt-2 h-[18px] w-24" />
      <Skeleton shape="card" className="h-[184px] w-full" />
      <Skeleton className="mt-2 h-[18px] w-16" />
      <Skeleton shape="card" className="h-[122px] w-full" />
    </div>
  );
}

// ─── Mobile: grouped by day ─────────────────────────────────────────────────

function DayGroups({
  expenses,
  today,
  memberIds,
  grouped,
  onOpen,
  onDelete,
}: {
  expenses: Expense[];
  today: string;
  memberIds: string[];
  grouped: boolean;
  onOpen: (id: string, mode?: "view" | "edit") => void;
  onDelete: (e: Expense) => void;
}) {
  const groups = useMemo(() => {
    if (!grouped) return [{ key: "all", label: null as string | null, items: expenses }];
    const out: { key: string; label: string | null; items: Expense[] }[] = [];
    for (const e of expenses) {
      const last = out.at(-1);
      if (last && last.key === e.spentOn) last.items.push(e);
      else out.push({ key: e.spentOn, label: dayLabel(e.spentOn, today), items: [e] });
    }
    return out;
  }, [expenses, grouped, today]);

  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label ?? "Dépenses"} className="flex flex-col">
          {g.label ? (
            <h2 className="sticky top-[calc(var(--topbar-h)+env(safe-area-inset-top))] z-10 -mx-4 flex items-center justify-between bg-bg px-4 pt-4 pb-2 text-sm font-medium text-fg-muted">
              <span>{g.label}</span>
              <Money cents={g.items.reduce((s, e) => s + e.amountCents - e.refundedCents, 0)} className="font-normal text-fg-subtle" />
            </h2>
          ) : null}
          <ListGroup as="ul">
            {g.items.map((e) => (
              <li key={e.id}>
                <SwipeRow
                  trailingActions={[
                    { id: "delete", label: "Supprimer", tone: "danger", icon: <Trash2 aria-hidden className="size-5" />, onAction: () => onDelete(e) },
                    { id: "edit", label: "Modifier", tone: "neutral", icon: <Pencil aria-hidden className="size-5" />, onAction: () => onOpen(e.id, "edit") },
                  ]}
                >
                  <ExpenseRow e={e} memberIds={memberIds} onOpen={() => onOpen(e.id)} showDate={!grouped} today={today} />
                </SwipeRow>
              </li>
            ))}
          </ListGroup>
        </section>
      ))}
    </div>
  );
}

function ExpenseRow({ e, memberIds, onOpen, showDate, today }: { e: Expense; memberIds: string[]; onOpen: () => void; showDate: boolean; today: string }) {
  const tone = e.payer.kind === "joint" ? "joint" : toneForMember(memberIds, e.payer.userId).key;
  const payerName = e.payer.kind === "joint" ? "Commun" : e.payer.isMe ? "Toi" : e.payer.name;
  return (
    <button type="button" onClick={onOpen} className="pressable flex w-full items-center gap-3 bg-surface pl-4 text-left hover:bg-surface-2 active:bg-surface-pressed focus-visible:-outline-offset-2">
      <Avatar name={e.payer.kind === "joint" ? "Compte commun" : e.payer.name} size="md" tone={tone} decorative />
      <span className="cn-row-sep relative flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-4">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base text-fg">{e.description}</span>
          <span className="truncate text-sm text-fg-subtle">
            {[showDate ? dayLabel(e.spentOn, today) : null, e.category?.name ?? "Sans catégorie", payerName].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <Money cents={e.amountCents} className="text-base text-fg" />
          {e.isPrivate ? (
            <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
              <Lock aria-hidden className="size-3" /> Privé
            </span>
          ) : e.refundedCents > 0 ? (
            <span className="text-xs text-accent-ink">
              Remboursé <Money cents={e.refundedCents} />
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

// ─── Desktop: dense table ───────────────────────────────────────────────────

function ExpenseTable({ expenses, sort, onSort, onOpen, today }: { expenses: Expense[]; sort: Sort; onSort: (s: Sort) => void; onOpen: (id: string) => void; today: string }) {
  const { members } = useMembers();
  const ids = members.map((m) => m.userId);
  const sortHeader = (label: string, key: "date" | "amount", align: "left" | "right") => {
    const active = sort.startsWith(key);
    const desc = sort.endsWith("desc");
    return (
      <th scope="col" aria-sort={active ? (desc ? "descending" : "ascending") : "none"} className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}>
        <button
          type="button"
          onClick={() => onSort(active ? (`${key}_${desc ? "asc" : "desc"}` as Sort) : (`${key}_desc` as Sort))}
          className={cn("-mx-1 inline-flex items-center gap-1 rounded-control px-1 hover:text-fg", active && "text-fg")}
        >
          {label}
          {active ? desc ? <ArrowDown aria-hidden className="size-3.5" /> : <ArrowUp aria-hidden className="size-3.5" /> : null}
        </button>
      </th>
    );
  };
  return (
    <div className="overflow-hidden rounded-card bg-surface">
      <table className="w-full table-fixed border-collapse text-base">
        <colgroup>
          <col className="w-24" />
          <col />
          <col className="w-44" />
          <col className="w-40" />
          <col className="w-32" />
          <col className="w-32" />
        </colgroup>
        <thead className="text-left text-sm text-fg-muted">
          <tr className="border-b border-border">
            {sortHeader("Date", "date", "left")}
            <th scope="col" className="px-3 py-2 font-medium">
              Description
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Catégorie
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Payé par
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Répartition
            </th>
            {sortHeader("Montant", "amount", "right")}
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => {
            const tone = e.payer.kind === "joint" ? "joint" : toneForMember(ids, e.payer.userId).key;
            return (
              <tr
                key={e.id}
                tabIndex={0}
                onClick={() => onOpen(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onOpen(e.id);
                  }
                }}
                className="h-10 cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2 focus-visible:-outline-offset-2"
              >
                <td className="num px-3 text-fg-muted">{e.spentOn === today ? "Aujourd'hui" : formatDateShortFr(e.spentOn)}</td>
                <td className="truncate px-3 text-fg">
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <span className="truncate">{e.description}</span>
                    {e.isPrivate ? <Lock aria-label="Privé" className="size-3.5 shrink-0 text-fg-subtle" /> : null}
                    {e.receiptPath ? <span className="sr-only">(reçu joint)</span> : null}
                  </span>
                </td>
                <td className="truncate px-3 text-fg-muted">{e.category?.name ?? "—"}</td>
                <td className="px-3">
                  <span className="inline-flex max-w-full items-center gap-2 text-fg-muted">
                    <Avatar name={e.payer.kind === "joint" ? "Compte commun" : e.payer.name} size="sm" tone={tone} decorative />
                    <span className="truncate">{e.payer.kind === "joint" ? "Commun" : e.payer.isMe ? "Toi" : e.payer.name}</span>
                  </span>
                </td>
                <td className="num truncate px-3 text-fg-muted">{splitLabel(e, members)}</td>
                <td className="px-3 text-right">
                  <Money cents={e.amountCents} className="text-fg" />
                  {e.refundedCents > 0 ? (
                    <span className="block text-xs leading-none text-accent-ink">
                      <Money cents={-e.refundedCents} sign />
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
