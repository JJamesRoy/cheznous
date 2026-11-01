"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { ChevronDown, Lock } from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { Avatar, ChipGroup, DateInput, Field, Input, MoneyInput, Select, Switch, Textarea } from "@/components/ui";
import { formatDateShortFr } from "@/domain/dates";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { toneForMember } from "@/lib/ui/people";
import { centsToInput, parseMoneyInput } from "@/lib/ui/format";
import { useMembers, useSession, type HouseholdSession } from "@/features/app/session";
import { ReceiptField } from "./receipt-field";
import { SplitEditor, exactRemaining, initialSplit, splitInput, type SplitState } from "./split-editor";
import type { Expense, Member, PayerChoice, SplitModeChoice } from "./shared";

export type ExpenseFormState = {
  amountText: string;
  amountCents: number | null;
  description: string;
  payer: PayerChoice;
  split: SplitState;
  categoryId: string | null;
  spentOn: string;
  notes: string;
  projectId: string | null;
  isPrivate: boolean;
  receiptPath: string | null;
};

export type ExpenseFormErrors = Partial<Record<"amount" | "description" | "split", string>>;

const NONE = "__none";

function defaultMode(session: HouseholdSession): SplitModeChoice {
  return session.household.defaultSplitMode === "income" ? "income" : "equal";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Fresh form, optionally pre-filled (shopping purchase, manifest shortcut…). */
export function emptyExpenseForm(
  session: HouseholdSession,
  me: Member,
  partner: Member | null,
  prefill?: Record<string, unknown>,
): ExpenseFormState {
  const p = prefill ?? {};
  const cents =
    typeof p.amountCents === "number"
      ? p.amountCents
      : typeof p.amount === "number"
        ? p.amount
        : typeof p.amount === "string"
          ? parseMoneyInput(p.amount)
          : null;
  const catRef = str(p.category) ?? str(p.categoryId);
  const cat = catRef
    ? session.categories.find((c) => c.id === catRef || c.name.toLowerCase() === catRef.toLowerCase())
    : undefined;
  const projRef = str(p.project) ?? str(p.projectId);
  const proj = projRef ? session.projects.find((x) => x.id === projRef || x.name.toLowerCase() === projRef.toLowerCase()) : undefined;
  const payerRef = str(p.payer);
  const payer: PayerChoice =
    payerRef === "joint" || payerRef === "commun"
      ? "joint"
      : payerRef && partner && (payerRef === "partner" || payerRef === partner.userId)
        ? "partner"
        : "me";
  return {
    amountText: cents !== null && cents !== undefined ? centsToInput(cents) : "",
    amountCents: cents ?? null,
    description: str(p.description) ?? "",
    payer,
    split: initialSplit(defaultMode(session), me, session.household.members),
    categoryId: cat?.id ?? null,
    spentOn: str(p.spentOn) ?? session.today,
    notes: str(p.notes) ?? "",
    projectId: proj?.id ?? null,
    isPrivate: p.isPrivate === true,
    receiptPath: str(p.receiptPath) ?? null,
  };
}

/** Form state from an existing expense (edit). */
export function formFromExpense(e: Expense, session: HouseholdSession, me: Member, partner: Member | null): ExpenseFormState {
  const base = initialSplit(defaultMode(session), me, session.household.members);
  let split: SplitState = base;
  if (e.splitMode === "equal" || e.splitMode === "income") split = { ...base, mode: e.splitMode };
  else if (e.splitMode === "percentage") {
    const mine = e.splits.find((s) => s.userId === me.userId)?.weight ?? 5000;
    split = { ...base, mode: "percentage", myPercent: Math.round(mine / 100) };
  } else if (e.splitMode === "exact") {
    const mine = e.splits.find((s) => s.userId === me.userId)?.shareCents ?? 0;
    const theirs = partner ? (e.splits.find((s) => s.userId === partner.userId)?.shareCents ?? 0) : 0;
    split = { ...base, mode: "exact", exactMine: centsToInput(mine), exactPartner: centsToInput(theirs), exactTouched: { mine: true, partner: true } };
  }
  return {
    amountText: centsToInput(e.amountCents),
    amountCents: e.amountCents,
    description: e.description,
    payer: e.payer.kind === "joint" ? "joint" : e.payer.isMe ? "me" : "partner",
    split,
    categoryId: e.category?.id ?? null,
    spentOn: e.spentOn,
    notes: e.notes ?? "",
    projectId: e.projectId,
    isPrivate: e.isPrivate,
    receiptPath: e.receiptPath,
  };
}

export function showsSplit(s: ExpenseFormState, partner: Member | null) {
  return Boolean(partner) && !s.isPrivate && s.payer !== "joint";
}

export function validateExpense(s: ExpenseFormState, partner: Member | null): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {};
  if (!s.amountCents || s.amountCents <= 0) errors.amount = "Entre un montant.";
  if (!s.description.trim()) errors.description = "Ajoute une description.";
  if (showsSplit(s, partner)) {
    const r = exactRemaining(s.split, s.amountCents);
    if (r !== null && r !== 0) errors.split = "Les deux parts doivent égaler le montant.";
  }
  return errors;
}

/** Payload shared by `expenses.create` and `expenses.update`. */
export function expenseInput(s: ExpenseFormState, me: Member, partner: Member | null) {
  const payer = s.isPrivate ? "moi" : s.payer === "joint" ? "commun" : s.payer === "partner" && partner ? partner.userId : me.userId;
  return {
    amount: { cents: s.amountCents ?? 0 },
    description: s.description.trim(),
    spentOn: s.spentOn,
    category: s.categoryId,
    payer,
    ...(showsSplit(s, partner) && partner ? { split: splitInput(s.split, me, partner) } : {}),
    isPrivate: s.isPrivate,
    notes: s.notes.trim() || null,
    receiptPath: s.receiptPath,
    project: s.projectId,
  };
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The expense fields, in the order of the 5-second flow: amount → description (with
 * history suggestions) → payer → split. Category, date, notes, project, privacy and receipt
 * sit under « Plus d'options » in quick mode, and are always shown in edit mode.
 */
export function ExpenseFields({
  state,
  onChange,
  errors,
  variant,
  amountRef,
  descriptionRef,
  canChangePrivacy = true,
  onReceiptBusy,
}: {
  state: ExpenseFormState;
  onChange: (next: ExpenseFormState) => void;
  errors: ExpenseFormErrors;
  variant: "quick" | "edit";
  amountRef?: RefObject<HTMLInputElement | null>;
  descriptionRef?: RefObject<HTMLInputElement | null>;
  canChangePrivacy?: boolean;
  onReceiptBusy?: (busy: boolean) => void;
}) {
  const session = useSession();
  const { me, partner, joint, members } = useMembers();
  const [moreOpen, setMoreOpen] = useState(variant === "edit");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const set = (patch: Partial<ExpenseFormState>) => onChange({ ...state, ...patch });
  const toneKey = (id: string) => toneForMember(members.map((x) => x.userId), id).key;

  const q = useDebounced(state.description.trim(), 120);
  const suggest = useOp(
    "expenses.suggest",
    { q, limit: 5 },
    { enabled: variant === "quick" && suggestOpen && q.length > 0, placeholderData: keepPreviousData, staleTime: 60_000 },
  );
  const suggestions = (suggest.data?.suggestions ?? []).filter((s) => s.description.toLowerCase() !== state.description.trim().toLowerCase() || s.uses > 1);

  const categories = useMemo(() => session.categories.filter((c) => !c.archived || c.id === state.categoryId), [session.categories, state.categoryId]);
  const category = session.categories.find((c) => c.id === state.categoryId);
  const project = session.projects.find((p) => p.id === state.projectId);

  function pick(sug: (typeof suggestions)[number]) {
    setSuggestOpen(false);
    const payer: PayerChoice = sug.payer === "joint" ? "joint" : sug.payer && partner && sug.payer === partner.userId ? "partner" : "me";
    let split = state.split;
    if (sug.split) {
      if (sug.split.mode === "percentage" && "percentages" in sug.split && sug.split.percentages) {
        const mine = sug.split.percentages[me.userId];
        split = { ...split, mode: "percentage", myPercent: typeof mine === "number" ? Math.round(mine) : split.myPercent };
      } else if (sug.split.mode === "equal" || sug.split.mode === "income") {
        split = { ...split, mode: sug.split.mode };
      }
    }
    onChange({
      ...state,
      description: sug.description,
      categoryId: sug.categoryId ?? state.categoryId,
      payer: sug.isPrivate ? "me" : payer,
      isPrivate: sug.isPrivate,
      split,
    });
  }

  const payerOptions = [
    { value: "me" as const, label: "Moi", leading: <Avatar name={me.displayName} size="sm" tone={toneKey(me.userId)} className="-ml-2" decorative /> },
    ...(partner
      ? [{ value: "partner" as const, label: partner.displayName, disabled: state.isPrivate, leading: <Avatar name={partner.displayName} size="sm" tone={toneKey(partner.userId)} className="-ml-2" decorative /> }]
      : []),
    { value: "joint" as const, label: joint.name || "Compte commun", disabled: state.isPrivate, leading: <Avatar name="Compte commun" size="sm" tone="joint" className="-ml-2" decorative /> },
  ];

  const summary = [
    category?.name,
    state.spentOn !== session.today ? formatDateShortFr(state.spentOn) : null,
    state.isPrivate ? "Privé" : null,
    project?.name,
    state.receiptPath ? "Reçu" : null,
    state.notes.trim() ? "Note" : null,
  ].filter(Boolean);

  const extras = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Catégorie">
          <Select
            value={state.categoryId ?? NONE}
            onValueChange={(v) => set({ categoryId: v === NONE ? null : v })}
            options={[{ value: NONE, label: "Sans catégorie" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
        <Field label="Date">
          <DateInput value={state.spentOn} max="2100-12-31" onValueChange={(v) => set({ spentOn: v || session.today })} />
        </Field>
      </div>
      {session.projects.length > 0 ? (
        <Field label="Projet">
          <Select
            value={state.projectId ?? NONE}
            onValueChange={(v) => set({ projectId: v === NONE ? null : v })}
            options={[{ value: NONE, label: "Aucun projet" }, ...session.projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
      ) : null}
      <Field label="Notes">
        <Textarea value={state.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Facultatif" />
      </Field>
      <Switch
        label={
          <span className="inline-flex items-center gap-1.5">
            <Lock aria-hidden className="size-3.5" /> Privé
          </span>
        }
        description={canChangePrivacy ? "Visible seulement par toi, hors balances" : "Seule la personne qui l'a ajoutée peut changer ce réglage"}
        checked={state.isPrivate}
        disabled={!canChangePrivacy}
        onCheckedChange={(v) => set({ isPrivate: v, ...(v ? { payer: "me" as const } : {}) })}
      />
      <ReceiptField householdId={session.household.id} value={state.receiptPath} onChange={(p) => set({ receiptPath: p })} onBusyChange={onReceiptBusy} />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <Field label="Montant" hideLabel error={errors.amount} className="items-center pt-1">
        <MoneyInput ref={amountRef} size="lg" autoFocus={variant === "quick"} value={state.amountText} onValueChange={(t, c) => set({ amountText: t, amountCents: c })} />
      </Field>

      <div className="relative flex flex-col gap-1.5">
        <Field label="Description" error={errors.description}>
          <Input
            ref={descriptionRef}
            value={state.description}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Épicerie, Hydro-Québec, dépanneur…"
            maxLength={140}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
            onChange={(e) => {
              set({ description: e.target.value });
              setSuggestOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && suggestOpen && suggestions.length) {
                e.stopPropagation();
                setSuggestOpen(false);
              }
            }}
            aria-autocomplete="list"
            aria-expanded={suggestOpen && suggestions.length > 0}
          />
        </Field>
        <AnimatePresence initial={false}>
          {variant === "quick" && suggestOpen && q.length > 0 && suggestions.length > 0 ? (
            <m.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.15 }}
              role="listbox"
              aria-label="Suggestions"
              className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {suggestions.map((s) => {
                const cat = session.categories.find((c) => c.id === s.categoryId);
                return (
                  <li key={s.description} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => pick(s)}
                      className="pressable flex h-11 shrink-0 flex-col items-start justify-center rounded-control bg-surface-2 px-3 text-left whitespace-nowrap hover:bg-surface-pressed md:h-10"
                    >
                      <span className="text-sm font-medium text-fg">{s.description}</span>
                      {cat ? <span className="text-xs text-fg-subtle">{cat.name}</span> : null}
                    </button>
                  </li>
                );
              })}
            </m.ul>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Payé par</span>
        <ChipGroup aria-label="Payé par" value={state.isPrivate ? "me" : state.payer} onValueChange={(v) => set({ payer: v })} options={payerOptions} layout="scroll" />
        {state.payer === "joint" && !state.isPrivate ? (
          <p className="text-sm text-fg-subtle">Payée avec le compte commun : aucune dette entre vous.</p>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {showsSplit(state, partner) && partner ? (
          <m.div
            key="split"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            <SplitEditor value={state.split} onChange={(split) => set({ split })} totalCents={state.amountCents} me={me} partner={partner} members={members} />
            {errors.split ? (
              <p className="mt-1.5 text-sm text-negative" role="alert">
                {errors.split}
              </p>
            ) : null}
          </m.div>
        ) : null}
      </AnimatePresence>

      {variant === "quick" ? (
        <div className="flex flex-col">
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className="-mx-2 flex min-h-11 items-center gap-2 rounded-control px-2 text-left text-base text-fg-muted hover:text-fg"
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-150", moreOpen && "rotate-180")} />
            <span className="shrink-0">Plus d&apos;options</span>
            {!moreOpen && summary.length ? <span className="truncate text-sm text-fg-subtle">{summary.join(" · ")}</span> : null}
          </button>
          {moreOpen ? <div className="pt-3">{extras}</div> : null}
        </div>
      ) : (
        extras
      )}
    </div>
  );
}
