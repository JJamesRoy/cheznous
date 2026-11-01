import { z } from "zod";
import { defineOp } from "../op";
import { AppError, fromDbError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import {
  idempotent,
  moneyToCents,
  requestHash,
  resolveCategory,
  resolveMember,
  resolvePayer,
  resolveProject,
  selectAll,
  today,
  zDate,
  zIdempotencyKey,
  zMoney,
} from "../support";
import { computeSplits, type SplitMode } from "../../domain/splits";
import { formatMoney } from "../../domain/money";
import { normalizeKey } from "../../domain/text";
import { parseDate } from "../../domain/dates";

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export type ExpenseRow = {
  id: string;
  household_id: string;
  amount_cents: number;
  description: string;
  spent_on: string;
  category_id: string | null;
  paid_by_user: string | null;
  paid_by_account: string | null;
  split_mode: SplitMode | "none";
  is_private: boolean;
  notes: string | null;
  receipt_path: string | null;
  project_id: string | null;
  recurring_rule_id: string | null;
  shopping_item_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  expense_splits: { user_id: string; share_cents: number; weight: number | null }[];
  budget_categories: { id: string; name: string } | null;
  refunds: { amount_cents: number }[];
};

export const EXPENSE_SELECT =
  "id, household_id, amount_cents, description, spent_on, category_id, paid_by_user, paid_by_account, split_mode, is_private, notes, receipt_path, project_id, recurring_rule_id, shopping_item_id, created_by, created_at, updated_at, updated_by, expense_splits(user_id, share_cents, weight), budget_categories(id, name), refunds(amount_cents)";

export function toExpenseDto(ctx: HouseholdCtx, r: ExpenseRow) {
  const order = ctx.household.members.map((m) => m.userId);
  const splits = [...r.expense_splits].sort((a, b) => order.indexOf(a.user_id) - order.indexOf(b.user_id));
  const refundedCents = r.refunds.reduce((s, x) => s + Number(x.amount_cents), 0);
  return {
    id: r.id,
    amountCents: Number(r.amount_cents),
    amount: formatMoney(Number(r.amount_cents)),
    description: r.description,
    spentOn: r.spent_on,
    category: r.budget_categories ? { id: r.budget_categories.id, name: r.budget_categories.name } : null,
    payer: r.paid_by_user
      ? { kind: "member" as const, userId: r.paid_by_user, name: memberName(ctx, r.paid_by_user), isMe: r.paid_by_user === ctx.userId }
      : { kind: "joint" as const, accountId: r.paid_by_account!, name: ctx.household.jointAccountName, isMe: false },
    splitMode: r.split_mode,
    splits: splits.map((s) => ({
      userId: s.user_id,
      name: memberName(ctx, s.user_id),
      shareCents: Number(s.share_cents),
      share: formatMoney(Number(s.share_cents)),
      weight: s.weight,
    })),
    isPrivate: r.is_private,
    notes: r.notes,
    receiptPath: r.receipt_path,
    projectId: r.project_id,
    recurringRuleId: r.recurring_rule_id,
    shoppingItemId: r.shopping_item_id,
    refundedCents,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ? { userId: r.updated_by, name: memberName(ctx, r.updated_by) } : null,
  };
}
export type ExpenseDto = ReturnType<typeof toExpenseDto>;

async function fetchExpense(ctx: HouseholdCtx, id: string): Promise<ExpenseRow> {
  const row = unwrap(
    await ctx.db.from("expenses").select(EXPENSE_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle(),
  ) as ExpenseRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Dépense introuvable.");
  return row;
}

// ---------------------------------------------------------------------------
// Input → persisted shape (shared by create & update)
// ---------------------------------------------------------------------------

export const zSplitInput = z.object({
  mode: z.enum(["equal", "percentage", "exact", "income"]),
  /** Member ref ("moi", name or id) → percent (e.g. 55 or 55.5). */
  percentages: z.record(z.string(), z.number().min(0).max(100)).optional(),
  /** Member ref → amount. */
  exact: z.record(z.string(), zMoney).optional(),
  /** Equal split among a subset (member refs). Defaults to everyone. */
  participants: z.array(z.string()).optional(),
});

const zExpenseFields = z.object({
  amount: zMoney,
  description: z.string().trim().min(1, "Ajoute une description.").max(140),
  spentOn: zDate.optional(),
  category: z.string().max(100).nullable().optional(),
  /** "moi", partner name, member id, or "commun" for the joint account. Default: me. */
  payer: z.string().max(100).optional(),
  split: zSplitInput.optional(),
  isPrivate: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  receiptPath: z.string().max(500).nullable().optional(),
  project: z.string().max(100).nullable().optional(),
});

type ExpenseFields = z.infer<typeof zExpenseFields>;

async function buildExpense(ctx: HouseholdCtx, input: ExpenseFields) {
  const amountCents = moneyToCents(input.amount);
  if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
  const spentOn = input.spentOn ? parseDate(input.spentOn) : today(ctx);
  const payer = resolvePayer(ctx, input.payer ?? "moi");
  const isPrivate = input.isPrivate ?? false;
  const category = input.category ? await resolveCategory(ctx, input.category) : null;
  const project = input.project ? await resolveProject(ctx, input.project) : null;

  if (input.receiptPath && !input.receiptPath.startsWith(`${ctx.household.id}/`)) {
    throw new AppError("FORBIDDEN", "Ce reçu n'appartient pas à ton foyer.");
  }
  if (isPrivate && payer.kind !== "member") {
    throw new AppError("VALIDATION", "Une dépense privée ne peut pas être payée par le compte commun.");
  }
  if (isPrivate && payer.kind === "member" && payer.userId !== ctx.userId) {
    throw new AppError("VALIDATION", "Une dépense privée est toujours payée par toi.");
  }

  let splitMode: SplitMode | "none" = "none";
  let splits: { user_id: string; share_cents: number; weight: number | null }[] = [];

  if (!isPrivate && payer.kind === "member") {
    const memberOrder = ctx.household.members.map((m) => m.userId);
    const mode: SplitMode = input.split?.mode ?? (ctx.household.defaultSplitMode === "income" ? "income" : "equal");
    const s = input.split;
    const computed = computeSplits({
      totalCents: amountCents,
      mode,
      memberOrder,
      participants: s?.participants?.map((p) => resolveMember(ctx, p)),
      percentagesBp: s?.percentages
        ? Object.fromEntries(Object.entries(s.percentages).map(([k, v]) => [resolveMember(ctx, k), Math.round(v * 100)]))
        : undefined,
      exactCents: s?.exact
        ? Object.fromEntries(Object.entries(s.exact).map(([k, v]) => [resolveMember(ctx, k), moneyToCents(v)]))
        : undefined,
      incomeWeightsBp: Object.fromEntries(ctx.household.members.map((m) => [m.userId, m.incomeWeightBp])),
    });
    splitMode = mode;
    splits = computed.map((c) => ({ user_id: c.userId, share_cents: c.shareCents, weight: c.weight }));
  }

  return {
    record: {
      household_id: ctx.household.id,
      amount_cents: amountCents,
      description: input.description,
      spent_on: spentOn,
      category_id: category?.id ?? null,
      paid_by_user: payer.kind === "member" ? payer.userId : null,
      paid_by_account: payer.kind === "joint" ? payer.accountId : null,
      split_mode: splitMode,
      is_private: isPrivate,
      notes: input.notes ?? null,
      receipt_path: input.receiptPath ?? null,
      project_id: project?.id ?? null,
    },
    splits,
  };
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export const createExpense = defineOp({
  name: "expenses.create",
  kind: "write",
  offline: true,
  input: zExpenseFields.extend({
    idempotencyKey: zIdempotencyKey.optional(),
    /** Links created by other use cases (shopping purchase, recurring rule). */
    shoppingItemId: z.string().uuid().optional(),
    recurringRuleId: z.string().uuid().optional(),
    recurringOccurrence: zDate.optional(),
  }),
  run: async (ctx, input) => {
    const { idempotencyKey, shoppingItemId, recurringRuleId, recurringOccurrence, ...fields } = input;
    const built = await buildExpense(ctx, fields);
    const res = await ctx.db.rpc("create_expense_tx", {
      p_expense: {
        ...built.record,
        shopping_item_id: shoppingItemId ?? null,
        recurring_rule_id: recurringRuleId ?? null,
        recurring_occurrence: recurringOccurrence ?? null,
      },
      p_splits: built.splits,
      p_idempotency_key: idempotencyKey ?? null,
      p_request_hash: idempotencyKey ? await requestHash(input) : null,
    });
    if (res.error) throw fromDbError(res.error);
    const out = res.data as { expense_id: string; replayed: boolean };
    const expense = toExpenseDto(ctx, await fetchExpense(ctx, out.expense_id));
    return { expense, replayed: out.replayed };
  },
});

export const updateExpense = defineOp({
  name: "expenses.update",
  kind: "write",
  input: zExpenseFields.partial().extend({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const current = toExpenseDto(ctx, await fetchExpense(ctx, input.id));
    // Merge: unspecified fields keep their value. Split is recomputed from the new total.
    const keepSplit =
      input.split ??
      (current.splitMode === "none"
        ? undefined
        : current.splitMode === "exact" && input.amount === undefined
          ? { mode: "exact" as const, exact: Object.fromEntries(current.splits.map((s) => [s.userId, { cents: s.shareCents }])) }
          : current.splitMode === "percentage"
            ? {
                mode: "percentage" as const,
                percentages: Object.fromEntries(current.splits.map((s) => [s.userId, (s.weight ?? 0) / 100])),
              }
            : current.splitMode === "equal"
              ? { mode: "equal" as const, participants: current.splits.map((s) => s.userId) }
              : current.splitMode === "exact"
                ? undefined // amount changed on an exact split: caller must provide a new split
                : { mode: current.splitMode });
    if (current.splitMode === "exact" && input.amount !== undefined && !input.split) {
      throw new AppError("VALIDATION", "Le montant a changé : précise la nouvelle répartition exacte.");
    }
    const merged: ExpenseFields = {
      amount: input.amount ?? { cents: current.amountCents },
      description: input.description ?? current.description,
      spentOn: input.spentOn ?? current.spentOn,
      category: input.category !== undefined ? input.category : (current.category?.id ?? null),
      payer: input.payer ?? (current.payer.kind === "joint" ? current.payer.accountId : current.payer.userId),
      split: keepSplit,
      isPrivate: input.isPrivate ?? current.isPrivate,
      notes: input.notes !== undefined ? input.notes : current.notes,
      receiptPath: input.receiptPath !== undefined ? input.receiptPath : current.receiptPath,
      project: input.project !== undefined ? input.project : current.projectId,
    };
    if (current.isPrivate !== merged.isPrivate && current.createdBy !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Seule la personne qui a créé la dépense peut changer sa confidentialité.");
    }
    const built = await buildExpense(ctx, merged);
    const res = await ctx.db.rpc("update_expense_tx", { p_id: input.id, p_expense: built.record, p_splits: built.splits });
    if (res.error) throw fromDbError(res.error);
    return { expense: toExpenseDto(ctx, await fetchExpense(ctx, input.id)), before: current };
  },
});

export const deleteExpense = defineOp({
  name: "expenses.delete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const snapshot = toExpenseDto(ctx, await fetchExpense(ctx, input.id));
    unwrap(await ctx.db.from("expenses").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { deleted: snapshot };
  },
});

export const getExpense = defineOp({
  name: "expenses.get",
  kind: "read",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => ({ expense: toExpenseDto(ctx, await fetchExpense(ctx, input.id)) }),
});

export const zExpenseFilters = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  category: z.string().max(100).optional(),
  payer: z.string().max(100).optional(),
  project: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
  includePrivate: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"),
});

export const listExpenses = defineOp({
  name: "expenses.list",
  kind: "read",
  input: zExpenseFilters,
  run: async (ctx, input) => {
    let q = ctx.db.from("expenses").select(EXPENSE_SELECT, { count: "exact" }).eq("household_id", ctx.household.id);
    if (input.from) q = q.gte("spent_on", parseDate(input.from));
    if (input.to) q = q.lte("spent_on", parseDate(input.to));
    if (input.category) q = q.eq("category_id", (await resolveCategory(ctx, input.category)).id);
    if (input.project) q = q.eq("project_id", (await resolveProject(ctx, input.project)).id);
    if (input.payer) {
      const p = resolvePayer(ctx, input.payer);
      q = p.kind === "joint" ? q.eq("paid_by_account", p.accountId) : q.eq("paid_by_user", p.userId);
    }
    if (input.search) {
      const key = normalizeKey(input.search);
      if (key) q = q.ilike("match_key", `%${key.replace(/[%_]/g, "")}%`);
    }
    if (input.includePrivate === false) q = q.eq("is_private", false);
    const [col, asc] =
      input.sort === "amount_desc" ? ["amount_cents", false] : input.sort === "amount_asc" ? ["amount_cents", true] : ["spent_on", input.sort === "date_asc"];
    q = q.order(col as string, { ascending: asc as boolean }).order("created_at", { ascending: asc as boolean });
    const res = await q.range(input.offset, input.offset + input.limit - 1);
    if (res.error) throw fromDbError(res.error);
    const rows = (res.data ?? []) as unknown as ExpenseRow[];
    const expenses = rows.map((r) => toExpenseDto(ctx, r));
    return {
      expenses,
      total: res.count ?? expenses.length,
      sumCents: expenses.reduce((s, e) => s + e.amountCents - e.refundedCents, 0),
    };
  },
});

/** Autocomplete from history: choosing a past merchant pre-fills its category and usual split. */
export const suggestExpenses = defineOp({
  name: "expenses.suggest",
  kind: "read",
  input: z.object({ q: z.string().max(100).default(""), limit: z.number().int().min(1).max(20).default(6) }),
  run: async (ctx, input) => {
    const key = normalizeKey(input.q);
    let q = ctx.db
      .from("expenses")
      .select("description, match_key, category_id, paid_by_user, paid_by_account, split_mode, amount_cents, spent_on, is_private, expense_splits(user_id, weight)")
      .eq("household_id", ctx.household.id)
      .order("spent_on", { ascending: false })
      .limit(300);
    if (key) q = q.ilike("match_key", `${key.replace(/[%_]/g, "")}%`);
    const rows = unwrap(await q) as {
      description: string;
      match_key: string;
      category_id: string | null;
      paid_by_user: string | null;
      paid_by_account: string | null;
      split_mode: SplitMode | "none";
      amount_cents: number;
      is_private: boolean;
      expense_splits: { user_id: string; weight: number | null }[];
    }[];
    const seen = new Map<string, { count: number; row: (typeof rows)[number] }>();
    for (const r of rows) {
      const e = seen.get(r.match_key);
      if (e) e.count++;
      else seen.set(r.match_key, { count: 1, row: r });
    }
    const suggestions = [...seen.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, input.limit)
      .map(({ row, count }) => ({
        description: row.description,
        categoryId: row.category_id,
        payer: row.paid_by_account ? "joint" : row.paid_by_user,
        isPrivate: row.is_private,
        split:
          row.split_mode === "none"
            ? null
            : row.split_mode === "percentage"
              ? { mode: "percentage" as const, percentages: Object.fromEntries(row.expense_splits.map((s) => [s.user_id, (s.weight ?? 0) / 100])) }
              : row.split_mode === "exact"
                ? { mode: "equal" as const }
                : { mode: row.split_mode },
        lastAmountCents: Number(row.amount_cents),
        uses: count,
      }));
    return { suggestions };
  },
});

// ---------------------------------------------------------------------------
// Refunds (store returns). Distinct from settlements and from expenses.
// ---------------------------------------------------------------------------

export const createRefund = defineOp({
  name: "refunds.create",
  kind: "write",
  input: z.object({
    expenseId: z.string().uuid(),
    amount: zMoney,
    /** Who received the money back: "moi", partner, or "commun". Default: the original payer. */
    receivedBy: z.string().max(100).optional(),
    refundedOn: zDate.optional(),
    note: z.string().max(500).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "refunds.create", input, async () => {
      const exp = toExpenseDto(ctx, await fetchExpense(ctx, input.expenseId));
      const amountCents = moneyToCents(input.amount);
      if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
      if (exp.refundedCents + amountCents > exp.amountCents) {
        throw new AppError(
          "VALIDATION",
          `Le remboursement dépasse la dépense (déjà remboursé : ${formatMoney(exp.refundedCents)} sur ${exp.amount}).`,
        );
      }
      const receiver = input.receivedBy
        ? resolvePayer(ctx, input.receivedBy)
        : exp.payer.kind === "joint"
          ? { kind: "joint" as const, accountId: exp.payer.accountId }
          : { kind: "member" as const, userId: exp.payer.userId };
      const row = unwrap(
        await ctx.db
          .from("refunds")
          .insert({
            household_id: ctx.household.id,
            expense_id: exp.id,
            amount_cents: amountCents,
            received_by_user: receiver.kind === "member" ? receiver.userId : null,
            received_by_account: receiver.kind === "joint" ? receiver.accountId : null,
            refunded_on: input.refundedOn ? parseDate(input.refundedOn) : today(ctx),
            note: input.note ?? null,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return { refundId: row.id, expenseId: exp.id, amountCents };
    }),
});

export const listRefunds = defineOp({
  name: "refunds.list",
  kind: "read",
  input: z.object({ expenseId: z.string().uuid().optional() }),
  run: async (ctx, input) => {
    const rows = await selectAll((from, to) => {
      let q = ctx.db
        .from("refunds")
        .select("id, expense_id, amount_cents, received_by_user, received_by_account, refunded_on, note")
        .eq("household_id", ctx.household.id)
        .order("refunded_on", { ascending: false });
      if (input.expenseId) q = q.eq("expense_id", input.expenseId);
      return q.range(from, to);
    });
    return { refunds: rows };
  },
});
