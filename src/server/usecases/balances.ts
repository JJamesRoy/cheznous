import { z } from "zod";
import { defineOp } from "../op";
import { AppError, unwrap } from "../errors";
import { memberName, partnerOf, type HouseholdCtx } from "../ctx";
import { idempotent, moneyToCents, resolveMember, selectAll, today, zDate, zIdempotencyKey, zMoney } from "../support";
import { computeBalances } from "../../domain/balances";
import { allocate } from "../../domain/splits";
import { formatMoney } from "../../domain/money";
import { parseDate } from "../../domain/dates";

type BalanceExpense = {
  id: string;
  amount_cents: number;
  description: string;
  spent_on: string;
  created_at: string;
  paid_by_user: string | null;
  is_private: boolean;
  expense_splits: { user_id: string; share_cents: number }[];
};
type BalanceRefund = { id: string; expense_id: string; amount_cents: number; received_by_user: string | null; refunded_on: string; created_at: string };
type BalanceSettlement = { id: string; from_user: string; to_user: string; amount_cents: number; settled_on: string; created_at: string; note: string | null };

export async function loadLedger(ctx: HouseholdCtx) {
  const hid = ctx.household.id;
  const [expenses, refunds, settlements] = await Promise.all([
    selectAll<BalanceExpense>((from, to) =>
      ctx.db
        .from("expenses")
        .select("id, amount_cents, description, spent_on, created_at, paid_by_user, is_private, expense_splits(user_id, share_cents)")
        .eq("household_id", hid)
        .eq("is_private", false)
        .not("paid_by_user", "is", null)
        .order("spent_on")
        .order("id")
        .range(from, to),
    ),
    selectAll<BalanceRefund>((from, to) =>
      ctx.db
        .from("refunds")
        .select("id, expense_id, amount_cents, received_by_user, refunded_on, created_at")
        .eq("household_id", hid)
        .order("refunded_on")
        .order("id")
        .range(from, to),
    ),
    selectAll<BalanceSettlement>((from, to) =>
      ctx.db
        .from("settlements")
        .select("id, from_user, to_user, amount_cents, settled_on, created_at, note")
        .eq("household_id", hid)
        .order("settled_on")
        .order("id")
        .range(from, to),
    ),
  ]);
  return { expenses, refunds, settlements };
}

function toDomain(ctx: HouseholdCtx, ledger: Awaited<ReturnType<typeof loadLedger>>) {
  return {
    memberOrder: ctx.household.members.map((m) => m.userId),
    expenses: ledger.expenses.map((e) => ({
      id: e.id,
      amountCents: Number(e.amount_cents),
      paidByUser: e.paid_by_user,
      isPrivate: e.is_private,
      splits: e.expense_splits.map((s) => ({ userId: s.user_id, shareCents: Number(s.share_cents) })),
    })),
    refunds: ledger.refunds.map((r) => ({ expenseId: r.expense_id, amountCents: Number(r.amount_cents), receivedByUser: r.received_by_user })),
    settlements: ledger.settlements.map((s) => ({ fromUser: s.from_user, toUser: s.to_user, amountCents: Number(s.amount_cents) })),
  };
}

export async function balancesFor(ctx: HouseholdCtx) {
  const ledger = await loadLedger(ctx);
  const result = computeBalances(toDomain(ctx, ledger));
  return { ledger, ...result };
}

function summarize(ctx: HouseholdCtx, net: Record<string, number>, transfers: { from: string; to: string; amountCents: number }[]) {
  const me = ctx.userId;
  const partner = partnerOf(ctx);
  const myNet = net[me] ?? 0;
  const kind = myNet > 0 ? "owed" : myNet < 0 ? "owes" : "even";
  const amountCents = Math.abs(myNet);
  const partnerName = partner?.displayName ?? "Ton partenaire";
  const sentence =
    kind === "even"
      ? "Vous êtes quittes"
      : kind === "owed"
        ? `${partnerName} te doit ${formatMoney(amountCents)}`
        : `Tu dois ${formatMoney(amountCents)} à ${partnerName}`;
  return {
    me: { kind, amountCents, amount: formatMoney(amountCents) },
    sentence,
    partner: partner ? { userId: partner.userId, name: partner.displayName } : null,
    net: ctx.household.members.map((m) => ({ userId: m.userId, name: m.displayName, netCents: net[m.userId] ?? 0, net: formatMoney(net[m.userId] ?? 0) })),
    transfers: transfers.map((t) => ({
      from: { userId: t.from, name: memberName(ctx, t.from) },
      to: { userId: t.to, name: memberName(ctx, t.to) },
      amountCents: t.amountCents,
      amount: formatMoney(t.amountCents),
      sentence: `${memberName(ctx, t.from)} doit ${formatMoney(t.amountCents)} à ${memberName(ctx, t.to)}`,
    })),
  };
}

/**
 * Balances + the transactions that produced them: everything since the balance was last
 * zero (typically, since the last settlement), newest first, with each item's effect on "me".
 */
export const getBalances = defineOp({
  name: "balances.get",
  kind: "read",
  input: z.object({ activityLimit: z.number().int().min(0).max(500).default(100) }),
  run: async (ctx, input) => {
    const { ledger, net, transfers } = await balancesFor(ctx);
    const domain = toDomain(ctx, ledger);

    type Item = {
      kind: "expense" | "refund" | "settlement";
      id: string;
      date: string;
      createdAt: string;
      title: string;
      amountCents: number;
      effectCents: number; // change of MY net
    };
    const items: Item[] = [];
    const me = ctx.userId;
    const order = domain.memberOrder;
    const expenseById = new Map(ledger.expenses.map((e) => [e.id, e]));
    const myShare = (e: BalanceExpense) => Number(e.expense_splits.find((s) => s.user_id === me)?.share_cents ?? 0);
    for (const e of ledger.expenses) {
      const paid = e.paid_by_user === me ? Number(e.amount_cents) : 0;
      items.push({ kind: "expense", id: e.id, date: e.spent_on, createdAt: e.created_at, title: e.description, amountCents: Number(e.amount_cents), effectCents: paid - myShare(e) });
    }
    for (const rf of ledger.refunds) {
      const exp = expenseById.get(rf.expense_id);
      if (!exp || !rf.received_by_user) continue;
      const weights = order
        .map((id) => ({ id, weight: Number(exp.expense_splits.find((s) => s.user_id === id)?.share_cents ?? 0) }))
        .filter((w) => w.weight > 0);
      const alloc = weights.length ? allocate(Number(rf.amount_cents), weights) : [];
      const mine = alloc.find((a) => a.id === me)?.cents ?? 0;
      const received = rf.received_by_user === me ? Number(rf.amount_cents) : 0;
      items.push({
        kind: "refund",
        id: rf.id,
        date: rf.refunded_on,
        createdAt: rf.created_at,
        title: `Remboursement · ${exp.description}`,
        amountCents: Number(rf.amount_cents),
        effectCents: mine - received,
      });
    }
    for (const s of ledger.settlements) {
      const effect = s.from_user === ctx.userId ? Number(s.amount_cents) : s.to_user === ctx.userId ? -Number(s.amount_cents) : 0;
      items.push({
        kind: "settlement",
        id: s.id,
        date: s.settled_on,
        createdAt: s.created_at,
        title: `Règlement · ${memberName(ctx, s.from_user)} → ${memberName(ctx, s.to_user)}`,
        amountCents: Number(s.amount_cents),
        effectCents: effect,
      });
    }
    items.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
    let running = 0;
    let lastZero = -1;
    items.forEach((it, i) => {
      running += it.effectCents;
      if (running === 0) lastZero = i;
    });
    const since = items.slice(lastZero + 1).reverse();
    return {
      ...summarize(ctx, net, transfers),
      activity: since.slice(0, input.activityLimit).map((i) => ({ ...i, amount: formatMoney(i.amountCents), effect: formatMoney(i.effectCents, { signDisplay: "exceptZero" }) })),
      activityCount: since.length,
      lastSettlement: ledger.settlements.length
        ? (() => {
            const s = ledger.settlements[ledger.settlements.length - 1];
            return { id: s.id, settledOn: s.settled_on, amountCents: Number(s.amount_cents), amount: formatMoney(Number(s.amount_cents)) };
          })()
        : null,
    };
  },
});

/**
 * Record a partner-to-partner payment. Without `confirm: true`, returns a preview of what
 * would happen and writes nothing (used by MCP; the app's slide-to-confirm sends confirm).
 */
export const createSettlement = defineOp({
  name: "settlements.create",
  kind: "write",
  input: z.object({
    /** Default: the full amount currently owed. */
    amount: zMoney.optional(),
    /** Default: whoever owes. */
    from: z.string().max(100).optional(),
    to: z.string().max(100).optional(),
    settledOn: zDate.optional(),
    note: z.string().max(500).optional(),
    confirm: z.boolean().default(false),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) => {
    if (ctx.household.members.length < 2) throw new AppError("VALIDATION", "Il faut deux membres pour enregistrer un règlement.");
    const { net, transfers } = await balancesFor(ctx);
    const owed = transfers[0];
    const from = input.from ? resolveMember(ctx, input.from) : owed?.from;
    const to = input.to ? resolveMember(ctx, input.to) : (owed?.to ?? ctx.household.members.find((m) => m.userId !== from)?.userId);
    if (!from || !to) throw new AppError("VALIDATION", "Vous êtes déjà quittes : précise le montant et qui paie qui.");
    if (from === to) throw new AppError("VALIDATION", "Un règlement se fait entre deux personnes différentes.");
    const amountCents = input.amount !== undefined ? moneyToCents(input.amount) : (owed && owed.from === from ? owed.amountCents : 0);
    if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant du règlement doit être plus grand que zéro.");

    const after = { ...net, [from]: (net[from] ?? 0) + amountCents, [to]: (net[to] ?? 0) - amountCents };
    const preview = {
      from: { userId: from, name: memberName(ctx, from) },
      to: { userId: to, name: memberName(ctx, to) },
      amountCents,
      amount: formatMoney(amountCents),
      settledOn: input.settledOn ? parseDate(input.settledOn) : today(ctx),
      before: summarize(ctx, net, transfers).sentence,
      after: summarize(ctx, after, computeAfter(after)).sentence,
    };
    if (!input.confirm) return { status: "preview" as const, preview, settlementId: null, replayed: false };

    const res = await idempotent(ctx, input.idempotencyKey, "settlements.create", input, async () => {
      const row = unwrap(
        await ctx.db
          .from("settlements")
          .insert({
            household_id: ctx.household.id,
            from_user: from,
            to_user: to,
            amount_cents: amountCents,
            settled_on: preview.settledOn,
            note: input.note ?? null,
            created_by: ctx.userId,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return { settlementId: row.id };
    });
    return { status: "recorded" as const, preview, settlementId: res.settlementId, replayed: res.replayed };
  },
});

function computeAfter(net: Record<string, number>) {
  const entries = Object.entries(net);
  const debtor = entries.find(([, v]) => v < 0);
  const creditor = entries.find(([, v]) => v > 0);
  return debtor && creditor ? [{ from: debtor[0], to: creditor[0], amountCents: Math.min(-debtor[1], creditor[1]) }] : [];
}

export const deleteSettlement = defineOp({
  name: "settlements.delete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const row = unwrap(
      await ctx.db.from("settlements").delete().eq("household_id", ctx.household.id).eq("id", input.id).select("id").maybeSingle(),
    );
    if (!row) throw new AppError("NOT_FOUND", "Règlement introuvable.");
    return { ok: true as const };
  },
});

/** Joint-account contributions compared to the household's target ratio. */
export const contributionsSummary = defineOp({
  name: "contributions.summary",
  kind: "read",
  input: z.object({ from: zDate.optional(), to: zDate.optional() }),
  run: async (ctx, input) => {
    let q = ctx.db.from("contributions").select("id, user_id, amount_cents, contributed_on, note").eq("household_id", ctx.household.id);
    if (input.from) q = q.gte("contributed_on", input.from);
    if (input.to) q = q.lte("contributed_on", input.to);
    const rows = unwrap(await q.order("contributed_on", { ascending: false })) as { id: string; user_id: string; amount_cents: number; contributed_on: string; note: string | null }[];
    const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
    const totalWeight = ctx.household.members.reduce((s, m) => s + m.incomeWeightBp, 0) || 1;
    return {
      totalCents: total,
      total: formatMoney(total),
      members: ctx.household.members.map((m) => {
        const c = rows.filter((r) => r.user_id === m.userId).reduce((s, r) => s + Number(r.amount_cents), 0);
        return {
          userId: m.userId,
          name: m.displayName,
          contributedCents: c,
          contributed: formatMoney(c),
          actualBp: total ? Math.round((c * 10000) / total) : 0,
          targetBp: Math.round((m.incomeWeightBp * 10000) / totalWeight),
        };
      }),
      recent: rows.slice(0, 20).map((r) => ({ ...r, amount_cents: Number(r.amount_cents), memberName: memberName(ctx, r.user_id) })),
    };
  },
});

export const createContribution = defineOp({
  name: "contributions.create",
  kind: "write",
  input: z.object({
    amount: zMoney,
    member: z.string().max(100).default("moi"),
    contributedOn: zDate.optional(),
    note: z.string().max(300).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "contributions.create", input, async () => {
      const row = unwrap(
        await ctx.db
          .from("contributions")
          .insert({
            household_id: ctx.household.id,
            account_id: ctx.household.jointAccountId,
            user_id: resolveMember(ctx, input.member),
            amount_cents: moneyToCents(input.amount),
            contributed_on: input.contributedOn ?? today(ctx),
            note: input.note ?? null,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return { contributionId: row.id };
    }),
});
