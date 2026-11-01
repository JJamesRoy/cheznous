import { z } from "zod";
import { defineOp, execute } from "../op";
import { AppError, unwrap } from "../errors";
import type { HouseholdCtx } from "../ctx";
import { moneyToCents, resolveCategory, today, zDate, zMoney } from "../support";
import { addDays, diffDays, formatDateFr, relativeDayFr } from "../../domain/dates";
import { FREQUENCY_LABELS_FR, nextOccurrenceOnOrAfter, occurrencesBetween, type Frequency } from "../../domain/recurrence";
import { formatMoney } from "../../domain/money";
import { createExpense, zSplitInput } from "./expenses";

type RuleRow = {
  id: string;
  kind: "expense" | "bill";
  title: string;
  amount_cents: number | null;
  category_id: string | null;
  frequency: Frequency;
  anchor_date: string;
  installment_dates: string[];
  end_date: string | null;
  template: { payer?: string; split?: z.infer<typeof zSplitInput> };
  auto_create: boolean;
  materialized_until: string | null;
  active: boolean;
  is_private: boolean;
  created_by: string;
  budget_categories: { id: string; name: string } | null;
};
const RULE_SELECT =
  "id, kind, title, amount_cents, category_id, frequency, anchor_date, installment_dates, end_date, template, auto_create, materialized_until, active, is_private, created_by, budget_categories(id, name)";

const asRule = (r: RuleRow) => ({ frequency: r.frequency, anchorDate: r.anchor_date, installmentDates: r.installment_dates, endDate: r.end_date });

function toRule(ctx: HouseholdCtx, r: RuleRow) {
  const t = today(ctx);
  const next = r.active ? nextOccurrenceOnOrAfter(asRule(r), t) : null;
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    amount: r.amount_cents === null ? null : formatMoney(Number(r.amount_cents)),
    category: r.budget_categories,
    frequency: r.frequency,
    frequencyLabel: FREQUENCY_LABELS_FR[r.frequency],
    anchorDate: r.anchor_date,
    installmentDates: r.installment_dates,
    endDate: r.end_date,
    template: r.template,
    autoCreate: r.auto_create,
    active: r.active,
    /** Private rules belong to the personal budget: only their author sees them. */
    isPrivate: r.is_private,
    nextDueOn: next,
    next: next ? { label: formatDateFr(next), relative: relativeDayFr(next, t) } : null,
  };
}

export const listRecurring = defineOp({
  name: "recurring.list",
  kind: "read",
  input: z.object({
    kind: z.enum(["expense", "bill"]).optional(),
    includeInactive: z.boolean().optional(),
    /** true: only my private rules (personal budget); false: only shared rules. Omit for both. */
    isPrivate: z.boolean().optional(),
  }),
  run: async (ctx, input) => {
    let q = ctx.db.from("recurring_rules").select(RULE_SELECT).eq("household_id", ctx.household.id);
    if (input.kind) q = q.eq("kind", input.kind);
    if (input.isPrivate !== undefined) q = q.eq("is_private", input.isPrivate);
    if (!input.includeInactive) q = q.eq("active", true);
    const rows = unwrap(await q.order("anchor_date")) as RuleRow[];
    const rules = rows.map((r) => toRule(ctx, r)).sort((a, b) => (a.nextDueOn ?? "9999") < (b.nextDueOn ?? "9999") ? -1 : 1);
    return { rules };
  },
});

export const upsertRecurring = defineOp({
  name: "recurring.upsert",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    kind: z.enum(["expense", "bill"]),
    title: z.string().trim().min(1).max(120),
    amount: zMoney.nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    frequency: z.enum(["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly", "installments"]),
    anchorDate: zDate,
    installmentDates: z.array(zDate).max(24).optional(),
    endDate: zDate.nullable().optional(),
    payer: z.string().max(100).optional(),
    split: zSplitInput.optional(),
    /** Automatically add the expense on each due date (on the next app open). */
    autoCreate: z.boolean().optional(),
    active: z.boolean().optional(),
    /** Personal (private) rule: paid by me, never split, visible to me only. */
    isPrivate: z.boolean().optional(),
  }),
  run: async (ctx, input) => {
    // On edit, an omitted flag keeps the rule's current privacy (never silently shares it).
    let isPrivate = input.isPrivate ?? false;
    if (input.id && input.isPrivate === undefined) {
      const cur = unwrap(
        await ctx.db.from("recurring_rules").select("is_private").eq("household_id", ctx.household.id).eq("id", input.id).maybeSingle(),
      ) as { is_private: boolean } | null;
      if (!cur) throw new AppError("NOT_FOUND", "Récurrence introuvable.");
      isPrivate = cur.is_private;
    }
    if (input.frequency === "installments" && !input.installmentDates?.length) {
      throw new AppError("VALIDATION", "Ajoute au moins une date de versement.");
    }
    const amountCents = input.amount ? moneyToCents(input.amount) : null;
    if (input.autoCreate && !amountCents) throw new AppError("VALIDATION", "Un montant est requis pour ajouter la dépense automatiquement.");
    const record = {
      household_id: ctx.household.id,
      kind: input.kind,
      title: input.title,
      amount_cents: amountCents,
      category_id: input.category ? (await resolveCategory(ctx, input.category)).id : null,
      frequency: input.frequency,
      anchor_date: input.anchorDate,
      installment_dates: input.frequency === "installments" ? [...new Set(input.installmentDates)].sort() : [],
      end_date: input.endDate ?? null,
      // A private expense is always paid by its author and never split.
      template: isPrivate ? { payer: ctx.userId } : { payer: input.payer, split: input.split },
      is_private: isPrivate,
      auto_create: input.autoCreate ?? false,
      active: input.active ?? true,
      // Never back-fill the past when a rule is created or edited.
      materialized_until: addDays(today(ctx), -1),
    };
    if (input.id) {
      const row = unwrap(await ctx.db.from("recurring_rules").update(record).eq("household_id", ctx.household.id).eq("id", input.id).select("id").maybeSingle());
      if (!row) throw new AppError("NOT_FOUND", "Récurrence introuvable.");
      return { id: input.id };
    }
    const row = unwrap(await ctx.db.from("recurring_rules").insert(record).select("id").single()) as { id: string };
    return { id: row.id };
  },
});

export const deleteRecurring = defineOp({
  name: "recurring.delete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    unwrap(await ctx.db.from("recurring_rules").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { ok: true as const };
  },
});

/**
 * Create the expenses of auto-create rules that came due since the last run. Lazy (called
 * when the app opens) so no cron is needed; the unique (rule, occurrence) index plus a
 * deterministic idempotency key make concurrent runs by both partners harmless.
 */
export const materializeRecurring = defineOp({
  name: "recurring.materialize",
  kind: "write",
  input: z.object({}).strict(),
  run: async (ctx) => {
    const t = today(ctx);
    const rules = unwrap(
      await ctx.db.from("recurring_rules").select(RULE_SELECT).eq("household_id", ctx.household.id).eq("kind", "expense").eq("auto_create", true).eq("active", true),
    ) as RuleRow[];
    let created = 0;
    for (const r of rules) {
      if (!r.amount_cents) continue;
      const from = r.materialized_until ? addDays(r.materialized_until, 1) : r.anchor_date;
      if (from > t) continue;
      for (const occ of occurrencesBetween(asRule(r), from, t).slice(0, 24)) {
        try {
          const res = await execute(createExpense, ctx, {
            amount: { cents: Number(r.amount_cents) },
            description: r.title,
            spentOn: occ,
            category: r.category_id,
            payer: r.is_private ? "moi" : (r.template?.payer ?? "commun"),
            split: r.is_private ? undefined : r.template?.split,
            isPrivate: r.is_private,
            recurringRuleId: r.id,
            recurringOccurrence: occ,
            idempotencyKey: `recurring:${r.id}:${occ}`,
          });
          if (!res.replayed) created++;
        } catch (e) {
          // The partner may have materialized the same occurrence (unique index) — skip.
          if ((e as { code?: string }).code !== "CONFLICT") throw e;
        }
      }
      unwrap(await ctx.db.from("recurring_rules").update({ materialized_until: t }).eq("id", r.id));
    }
    return { created };
  },
});

/** Upcoming bills and recurring expenses (next N days), for the dashboard and MCP. */
export async function upcomingFromRules(ctx: HouseholdCtx, days: number) {
  const t = today(ctx);
  const end = addDays(t, days);
  const rows = unwrap(await ctx.db.from("recurring_rules").select(RULE_SELECT).eq("household_id", ctx.household.id).eq("active", true)) as RuleRow[];
  return rows
    .flatMap((r) =>
      occurrencesBetween(asRule(r), t, end).map((d) => ({
        id: `${r.id}:${d}`,
        ruleId: r.id,
        kind: r.kind,
        title: r.title,
        date: d,
        daysUntil: diffDays(t, d),
        relative: relativeDayFr(d, t),
        amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
        amount: r.amount_cents === null ? null : formatMoney(Number(r.amount_cents)),
        category: r.budget_categories?.name ?? null,
      })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const upcomingBills = defineOp({
  name: "bills.upcoming",
  kind: "read",
  input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
  run: async (ctx, input) => {
    const items = await upcomingFromRules(ctx, input.days);
    const totalCents = items.reduce((s, i) => s + (i.amountCents ?? 0), 0);
    return { days: input.days, items, totalCents, total: formatMoney(totalCents) };
  },
});
