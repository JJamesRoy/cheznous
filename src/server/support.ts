import { z } from "zod";
import { matchByName, normalizeKey } from "../domain/text";
import { parseMoney } from "../domain/money";
import { todayIn } from "../domain/dates";
import { AppError, fromDbError, unwrap } from "./errors";
import type { HouseholdCtx } from "./ctx";

// ---------------------------------------------------------------------------
// Shared Zod fragments
// ---------------------------------------------------------------------------

export const zUuid = z.string().uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, "Mois attendu au format AAAA-MM");
export const zIdempotencyKey = z.string().min(8).max(200);

/** Money as a decimal string ("85", "85,50", "1 234,56 $") or as integer cents. */
export const zMoney = z.union([
  z.string().min(1).max(32),
  z.object({ cents: z.number().int().nonnegative().max(1_000_000_000_000) }),
]);
export type MoneyInput = z.infer<typeof zMoney>;

export function moneyToCents(m: MoneyInput): number {
  return typeof m === "string" ? parseMoney(m) : m.cents;
}

export function today(ctx: HouseholdCtx): string {
  return todayIn(ctx.household.timezone);
}

// ---------------------------------------------------------------------------
// Reference resolution: "moi", partner name, uuid, category/list names
// ---------------------------------------------------------------------------

const ME = new Set(["moi", "me", "je", "myself", "self", "mine", "moi meme"]);
const JOINT = new Set(["compte commun", "commun", "joint", "joint account", "compte conjoint", "conjoint", "compte"]);

export type PayerRef = { kind: "member"; userId: string } | { kind: "joint"; accountId: string };

export function resolveMember(ctx: HouseholdCtx, ref: string): string {
  const key = normalizeKey(ref);
  if (ME.has(key)) return ctx.userId;
  const byId = ctx.household.members.find((m) => m.userId === ref);
  if (byId) return byId.userId;
  if (["partenaire", "partner", "l autre", "conjoint e", "conjointe"].includes(key)) {
    const p = ctx.household.members.find((m) => m.userId !== ctx.userId);
    if (p) return p.userId;
  }
  const res = matchByName(ctx.household.members, ref, (m) => m.displayName);
  if (res.kind === "match") return res.item.userId;
  const options = ctx.household.members.map((m) => (m.userId === ctx.userId ? `${m.displayName} (moi)` : m.displayName));
  throw new AppError(
    res.kind === "ambiguous" ? "AMBIGUOUS" : "VALIDATION",
    `Membre « ${ref} » introuvable. Choix possibles : ${options.join(", ")}.`,
    { options },
  );
}

export function resolvePayer(ctx: HouseholdCtx, ref: string): PayerRef {
  const key = normalizeKey(ref);
  if (JOINT.has(key) || ref === ctx.household.jointAccountId || key === normalizeKey(ctx.household.jointAccountName)) {
    return { kind: "joint", accountId: ctx.household.jointAccountId };
  }
  return { kind: "member", userId: resolveMember(ctx, ref) };
}

type Named = { id: string; name: string };

async function resolveNamed(
  ctx: HouseholdCtx,
  table: "budget_categories" | "shopping_lists" | "projects" | "savings_goals",
  ref: string,
  label: string,
): Promise<Named> {
  if (z.string().uuid().safeParse(ref).success) {
    const row = unwrap(await ctx.db.from(table).select("id, name").eq("household_id", ctx.household.id).eq("id", ref).maybeSingle()) as Named | null;
    if (!row) throw new AppError("NOT_FOUND", `${label} introuvable.`);
    return row;
  }
  let query = ctx.db.from(table).select("id, name").eq("household_id", ctx.household.id);
  if (table === "budget_categories" || table === "shopping_lists") query = query.eq("archived", false);
  const rows = unwrap(await query) as Named[];
  const res = matchByName(rows, ref, (r) => r.name);
  if (res.kind === "match") return res.item;
  const options = (res.kind === "ambiguous" ? res.options : rows).map((r) => r.name);
  throw new AppError(
    res.kind === "ambiguous" ? "AMBIGUOUS" : "VALIDATION",
    res.kind === "ambiguous"
      ? `« ${ref} » correspond à plusieurs ${label.toLowerCase()}s : ${options.join(", ")}.`
      : `${label} « ${ref} » introuvable. Choix possibles : ${options.join(", ")}.`,
    { options },
  );
}

export const resolveCategory = (ctx: HouseholdCtx, ref: string) => resolveNamed(ctx, "budget_categories", ref, "Catégorie");
export const resolveList = (ctx: HouseholdCtx, ref: string) => resolveNamed(ctx, "shopping_lists", ref, "Liste");
export const resolveProject = (ctx: HouseholdCtx, ref: string) => resolveNamed(ctx, "projects", ref, "Projet");
export const resolveGoal = (ctx: HouseholdCtx, ref: string) => resolveNamed(ctx, "savings_goals", ref, "Objectif");

// ---------------------------------------------------------------------------
// Pagination: PostgREST caps responses at max_rows (1000). Read everything.
// ---------------------------------------------------------------------------

export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw fromDbError(error);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

// ---------------------------------------------------------------------------
// Idempotency (generic). Expense creation uses the transactional SQL variant.
// ---------------------------------------------------------------------------

export async function requestHash(value: unknown): Promise<string> {
  const json = JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Run `fn` at most once per (user, key). A retry with the same key and the same
 * input returns the stored result with `replayed: true`.
 */
export async function idempotent<T extends Record<string, unknown>>(
  ctx: HouseholdCtx,
  key: string | undefined,
  operation: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T & { replayed: boolean }> {
  if (!key) return { ...(await fn()), replayed: false };
  const hash = await requestHash(input);
  const prior = await ctx.db.rpc("claim_idempotency", { p_key: key, p_operation: operation, p_hash: hash });
  if (prior.error) throw fromDbError(prior.error);
  if (prior.data) return { ...(prior.data as T), replayed: true };
  try {
    const result = await fn();
    const up = await ctx.db.from("idempotency_keys").update({ response: result }).eq("user_id", ctx.userId).eq("key", key);
    if (up.error) throw fromDbError(up.error);
    return { ...result, replayed: false };
  } catch (e) {
    // Release the key so the client can retry after a failure.
    await ctx.db.from("idempotency_keys").delete().eq("user_id", ctx.userId).eq("key", key).is("response", null);
    throw e;
  }
}
