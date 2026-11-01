import { z } from "zod";
import { defineOp, execute } from "../op";
import { AppError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import { idempotent, moneyToCents, resolveList, resolveMember, zIdempotencyKey, zMoney } from "../support";
import { estimatedTotal, lineTotalCents, parseItemLine } from "../../domain/shopping";
import { formatMoney } from "../../domain/money";
import { createExpense, zSplitInput } from "./expenses";

type ItemRow = {
  id: string;
  list_id: string;
  name: string;
  quantity: number | string;
  unit_price_cents: number | null;
  url: string | null;
  image_url: string | null;
  category: string | null;
  priority: number;
  assignee: string | null;
  notes: string | null;
  purchased_at: string | null;
  purchased_by: string | null;
  expense_id: string | null;
  sort: number;
  created_by: string;
  created_at: string;
};

const ITEM_SELECT = "id, list_id, name, quantity, unit_price_cents, url, image_url, category, priority, assignee, notes, purchased_at, purchased_by, expense_id, sort, created_by, created_at";

function toItem(ctx: HouseholdCtx, r: ItemRow) {
  const quantity = Number(r.quantity);
  const unit = r.unit_price_cents === null ? null : Number(r.unit_price_cents);
  const total = unit === null ? null : lineTotalCents(quantity, unit);
  return {
    id: r.id,
    listId: r.list_id,
    name: r.name,
    quantity,
    unitPriceCents: unit,
    unitPrice: unit === null ? null : formatMoney(unit),
    totalCents: total,
    total: total === null ? null : formatMoney(total),
    url: r.url,
    imageUrl: r.image_url,
    category: r.category,
    priority: r.priority as 0 | 1 | 2,
    assignee: r.assignee ? { userId: r.assignee, name: memberName(ctx, r.assignee) } : null,
    notes: r.notes,
    purchased: !!r.purchased_at,
    purchasedAt: r.purchased_at,
    purchasedBy: r.purchased_by ? { userId: r.purchased_by, name: memberName(ctx, r.purchased_by) } : null,
    expenseId: r.expense_id,
    sort: r.sort,
    createdAt: r.created_at,
  };
}
export type ShoppingItemDto = ReturnType<typeof toItem>;

async function fetchItem(ctx: HouseholdCtx, id: string) {
  const row = unwrap(await ctx.db.from("shopping_items").select(ITEM_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle()) as ItemRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Article introuvable.");
  return row;
}

/** Category used when a purchase creates an expense, by list kind. */
const LIST_KIND_CATEGORY: Record<string, string> = {
  groceries: "Épicerie",
  furniture: "Meubles et déco",
  household: "Épicerie",
  wishlist: "Divers",
  custom: "Divers",
};

export const listShoppingLists = defineOp({
  name: "shopping.lists",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().optional() }),
  run: async (ctx, input) => {
    let q = ctx.db.from("shopping_lists").select("id, name, kind, sort, archived, project_id").eq("household_id", ctx.household.id).order("sort");
    if (!input.includeArchived) q = q.eq("archived", false);
    const lists = unwrap(await q) as { id: string; name: string; kind: string; sort: number; archived: boolean; project_id: string | null }[];
    const items = unwrap(
      await ctx.db.from("shopping_items").select("list_id, name, quantity, unit_price_cents, purchased_at, priority").eq("household_id", ctx.household.id),
    ) as { list_id: string; name: string; quantity: number; unit_price_cents: number | null; purchased_at: string | null; priority: number }[];
    return {
      lists: lists.map((l) => {
        const mine = items.filter((i) => i.list_id === l.id);
        const est = estimatedTotal(mine.map((i) => ({ quantity: Number(i.quantity), unitPriceCents: i.unit_price_cents === null ? null : Number(i.unit_price_cents), purchased: !!i.purchased_at })));
        const open = mine.filter((i) => !i.purchased_at);
        return {
          id: l.id,
          name: l.name,
          kind: l.kind,
          archived: l.archived,
          projectId: l.project_id,
          openCount: open.length,
          purchasedCount: mine.length - open.length,
          remainingCents: est.remainingCents,
          remaining: formatMoney(est.remainingCents),
          preview: open.sort((a, b) => b.priority - a.priority).slice(0, 3).map((i) => i.name),
        };
      }),
    };
  },
});

export const getShoppingList = defineOp({
  name: "shopping.list",
  kind: "read",
  input: z.object({ list: z.string().max(100), includePurchased: z.boolean().default(true) }),
  run: async (ctx, input) => {
    const list = await resolveList(ctx, input.list);
    const meta = unwrap(await ctx.db.from("shopping_lists").select("id, name, kind, project_id").eq("id", list.id).single()) as { id: string; name: string; kind: string; project_id: string | null };
    let q = ctx.db.from("shopping_items").select(ITEM_SELECT).eq("household_id", ctx.household.id).eq("list_id", list.id);
    if (!input.includePurchased) q = q.is("purchased_at", null);
    const rows = unwrap(await q.order("purchased_at", { ascending: true, nullsFirst: true }).order("priority", { ascending: false }).order("sort")) as ItemRow[];
    const items = rows.map((r) => toItem(ctx, r));
    const est = estimatedTotal(items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, purchased: i.purchased })));
    const expenseIds = items.map((i) => i.expenseId).filter((x): x is string => !!x);
    let actualCents = 0;
    if (expenseIds.length) {
      const ex = unwrap(await ctx.db.from("expenses").select("amount_cents").in("id", expenseIds)) as { amount_cents: number }[];
      actualCents = ex.reduce((s, e) => s + Number(e.amount_cents), 0);
    }
    return {
      list: { id: meta.id, name: meta.name, kind: meta.kind, projectId: meta.project_id },
      items,
      totals: {
        estimatedRemainingCents: est.remainingCents,
        estimatedRemaining: formatMoney(est.remainingCents),
        estimatedPurchasedCents: est.purchasedCents,
        estimatedPurchased: formatMoney(est.purchasedCents),
        actualSpentCents: actualCents,
        actualSpent: formatMoney(actualCents),
        unpricedCount: est.unknownCount,
      },
    };
  },
});

export const upsertShoppingList = defineOp({
  name: "shopping.upsertList",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60),
    kind: z.enum(["groceries", "furniture", "household", "wishlist", "custom"]).default("custom"),
    archived: z.boolean().optional(),
  }),
  run: async (ctx, input) => {
    if (input.id) {
      const row = unwrap(
        await ctx.db.from("shopping_lists").update({ name: input.name, kind: input.kind, ...(input.archived !== undefined ? { archived: input.archived } : {}) }).eq("household_id", ctx.household.id).eq("id", input.id).select("id").maybeSingle(),
      );
      if (!row) throw new AppError("NOT_FOUND", "Liste introuvable.");
      return { id: input.id };
    }
    const max = unwrap(await ctx.db.from("shopping_lists").select("sort").eq("household_id", ctx.household.id).order("sort", { ascending: false }).limit(1)) as { sort: number }[];
    const row = unwrap(
      await ctx.db.from("shopping_lists").insert({ household_id: ctx.household.id, name: input.name, kind: input.kind, sort: (max[0]?.sort ?? 0) + 10 }).select("id").single(),
    ) as { id: string };
    return { id: row.id };
  },
});

const zItemFields = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().positive().max(999).optional(),
  unitPrice: zMoney.nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  assignee: z.string().max(100).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const addShoppingItem = defineOp({
  name: "shopping.addItem",
  kind: "write",
  offline: true,
  input: zItemFields.extend({
    list: z.string().max(100),
    /** One-line entry: "2 lait 3,99" → quantity 2, name lait, unit price 3,99 $. */
    line: z.string().max(200).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
    clientId: z.string().uuid().optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "shopping.addItem", input, async () => {
      const list = await resolveList(ctx, input.list);
      const parsed = input.line ? parseItemLine(input.line) : null;
      const name = input.name ?? parsed?.name;
      if (!name) throw new AppError("VALIDATION", "Nomme l'article.");
      const unit = input.unitPrice !== undefined && input.unitPrice !== null ? moneyToCents(input.unitPrice) : (parsed?.unitPriceCents ?? null);
      const row = unwrap(
        await ctx.db
          .from("shopping_items")
          .insert({
            ...(input.clientId ? { id: input.clientId } : {}),
            household_id: ctx.household.id,
            list_id: list.id,
            name,
            quantity: input.quantity ?? parsed?.quantity ?? 1,
            unit_price_cents: unit,
            url: input.url ?? null,
            image_url: input.imageUrl ?? null,
            category: input.category ?? null,
            priority: input.priority ?? 0,
            assignee: input.assignee ? resolveMember(ctx, input.assignee) : null,
            notes: input.notes ?? null,
          })
          .select(ITEM_SELECT)
          .single(),
      ) as ItemRow;
      return { item: toItem(ctx, row), list: { id: list.id, name: list.name } };
    }),
});

export const updateShoppingItem = defineOp({
  name: "shopping.updateItem",
  kind: "write",
  input: zItemFields.extend({ id: z.string().uuid(), list: z.string().max(100).optional() }),
  run: async (ctx, input) => {
    await fetchItem(ctx, input.id);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.unitPrice !== undefined) patch.unit_price_cents = input.unitPrice === null ? null : moneyToCents(input.unitPrice);
    if (input.url !== undefined) patch.url = input.url;
    if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
    if (input.category !== undefined) patch.category = input.category;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.assignee !== undefined) patch.assignee = input.assignee ? resolveMember(ctx, input.assignee) : null;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.list !== undefined) patch.list_id = (await resolveList(ctx, input.list)).id;
    const row = unwrap(await ctx.db.from("shopping_items").update(patch).eq("household_id", ctx.household.id).eq("id", input.id).select(ITEM_SELECT).single()) as ItemRow;
    return { item: toItem(ctx, row) };
  },
});

/** Check / uncheck. Naturally idempotent (sets a state), so safe to replay offline. */
export const toggleShoppingItem = defineOp({
  name: "shopping.toggleItem",
  kind: "write",
  offline: true,
  input: z.object({ id: z.string().uuid(), purchased: z.boolean(), idempotencyKey: zIdempotencyKey.optional() }),
  run: async (ctx, input) => {
    const cur = await fetchItem(ctx, input.id);
    if (!!cur.purchased_at === input.purchased) return { item: toItem(ctx, cur) };
    const row = unwrap(
      await ctx.db
        .from("shopping_items")
        .update(input.purchased ? { purchased_at: new Date().toISOString(), purchased_by: ctx.userId } : { purchased_at: null, purchased_by: null })
        .eq("household_id", ctx.household.id)
        .eq("id", input.id)
        .select(ITEM_SELECT)
        .single(),
    ) as ItemRow;
    return { item: toItem(ctx, row) };
  },
});

/**
 * Mark purchased and (optionally) create the linked expense, pre-filled from the item:
 * amount = quantity × unit price unless overridden, category from the list kind.
 */
export const purchaseShoppingItem = defineOp({
  name: "shopping.purchase",
  kind: "write",
  input: z.object({
    id: z.string().uuid(),
    createExpense: z.boolean().default(true),
    amount: zMoney.optional(),
    description: z.string().max(140).optional(),
    payer: z.string().max(100).optional(),
    split: zSplitInput.optional(),
    category: z.string().max(100).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) => {
    const cur = await fetchItem(ctx, input.id);
    const item = toItem(ctx, cur);
    let expense = null;
    if (input.createExpense && !cur.expense_id) {
      const amount = input.amount ?? (item.totalCents ? { cents: item.totalCents } : undefined);
      if (!amount) throw new AppError("VALIDATION", "Indique le montant payé pour créer la dépense.");
      const list = unwrap(await ctx.db.from("shopping_lists").select("kind, project_id").eq("id", cur.list_id).single()) as { kind: string; project_id: string | null };
      const r = await execute(createExpense, ctx, {
        amount,
        description: input.description ?? item.name,
        payer: input.payer,
        split: input.split,
        category: input.category ?? LIST_KIND_CATEGORY[list.kind] ?? null,
        project: list.project_id ?? undefined,
        shoppingItemId: item.id,
        idempotencyKey: input.idempotencyKey,
      });
      expense = r.expense;
    }
    const row = unwrap(
      await ctx.db
        .from("shopping_items")
        .update({
          purchased_at: cur.purchased_at ?? new Date().toISOString(),
          purchased_by: cur.purchased_by ?? ctx.userId,
          ...(expense ? { expense_id: expense.id } : {}),
        })
        .eq("household_id", ctx.household.id)
        .eq("id", input.id)
        .select(ITEM_SELECT)
        .single(),
    ) as ItemRow;
    return { item: toItem(ctx, row), expense };
  },
});

export const deleteShoppingItem = defineOp({
  name: "shopping.deleteItem",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const snapshot = toItem(ctx, await fetchItem(ctx, input.id));
    unwrap(await ctx.db.from("shopping_items").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { deleted: snapshot };
  },
});

export const clearPurchased = defineOp({
  name: "shopping.clearPurchased",
  kind: "write",
  input: z.object({ list: z.string().max(100) }),
  run: async (ctx, input) => {
    const list = await resolveList(ctx, input.list);
    const rows = unwrap(
      await ctx.db.from("shopping_items").delete().eq("household_id", ctx.household.id).eq("list_id", list.id).not("purchased_at", "is", null).select("id"),
    ) as { id: string }[];
    return { removed: rows.length };
  },
});
