import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, unwrap } from "./errors";

export type Member = {
  userId: string;
  displayName: string;
  avatarPath: string | null;
  role: "owner" | "member";
  incomeWeightBp: number;
  payAnchorDate: string | null;
  joinedAt: string;
};

export type Household = {
  id: string;
  name: string;
  timezone: string;
  weekStart: number;
  defaultSplitMode: "equal" | "income";
  onboardingStep: string;
  jointAccountId: string;
  jointAccountName: string;
  /** Canonical order: joined_at asc, then user_id asc. Used for remainder-cent tie-breaks. */
  members: Member[];
};

export type Source = "app" | "mcp" | "test";

export type Ctx = {
  /** User-scoped client — RLS applies to every query. */
  db: SupabaseClient;
  userId: string;
  email: string | null;
  source: Source;
  clientId: string | null;
  /** Null until the user creates or joins a household. */
  household: Household | null;
};

export type HouseholdCtx = Ctx & { household: Household };

export function requireHousehold(ctx: Ctx): HouseholdCtx {
  if (!ctx.household) {
    throw new AppError("NO_HOUSEHOLD", "Crée ou rejoins un foyer pour continuer.");
  }
  return ctx as HouseholdCtx;
}

type MemberRow = {
  household_id: string;
  user_id: string;
  role: "owner" | "member";
  income_weight_bp: number;
  pay_anchor_date: string | null;
  joined_at: string;
};

export function canonicalOrder<T extends { joinedAt: string; userId: string }>(members: T[]): T[] {
  return [...members].sort((a, b) =>
    a.joinedAt === b.joinedAt ? (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0) : a.joinedAt < b.joinedAt ? -1 : 1,
  );
}

/** Load the household (if any) for this user. Uses only the user-scoped client. */
export async function loadHousehold(db: SupabaseClient, userId: string): Promise<Household | null> {
  const mine = unwrap(
    await db
      .from("household_members")
      .select("household_id, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1),
  ) as { household_id: string }[];
  if (mine.length === 0) return null;
  const householdId = mine[0].household_id;

  const [hh, members, accounts] = await Promise.all([
    db.from("households").select("id, name, timezone, week_start, default_split_mode, onboarding_step").eq("id", householdId).single(),
    db
      .from("household_members")
      .select("household_id, user_id, role, income_weight_bp, pay_anchor_date, joined_at")
      .eq("household_id", householdId),
    db.from("accounts").select("id, name").eq("household_id", householdId).eq("kind", "joint").limit(1),
  ]);
  const h = unwrap(hh) as {
    id: string;
    name: string;
    timezone: string;
    week_start: number;
    default_split_mode: "equal" | "income";
    onboarding_step: string;
  };
  const memberRows = unwrap(members) as MemberRow[];
  const account = (unwrap(accounts) as { id: string; name: string }[])[0];

  const ids = memberRows.map((m) => m.user_id);
  const profiles = unwrap(await db.from("profiles").select("id, display_name, avatar_path").in("id", ids)) as {
    id: string;
    display_name: string;
    avatar_path: string | null;
  }[];
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return {
    id: h.id,
    name: h.name,
    timezone: h.timezone,
    weekStart: h.week_start,
    defaultSplitMode: h.default_split_mode,
    onboardingStep: h.onboarding_step,
    jointAccountId: account?.id ?? "",
    jointAccountName: account?.name ?? "Compte commun",
    members: canonicalOrder(
      memberRows.map((m) => ({
        userId: m.user_id,
        displayName: byId.get(m.user_id)?.display_name || "Membre",
        avatarPath: byId.get(m.user_id)?.avatar_path ?? null,
        role: m.role,
        incomeWeightBp: m.income_weight_bp,
        payAnchorDate: m.pay_anchor_date,
        joinedAt: m.joined_at,
      })),
    ),
  };
}

/**
 * Build a request context from a user-scoped client. Identity is read from the
 * verified JWT claims (`getClaims` verifies the signature against the project JWKS).
 */
export async function buildCtx(
  db: SupabaseClient,
  opts: { source: Source; clientId?: string | null; claims?: { sub: string; email?: string | null } },
): Promise<Ctx> {
  let sub = opts.claims?.sub;
  let email = opts.claims?.email ?? null;
  if (!sub) {
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub) throw new AppError("UNAUTHENTICATED", "Connecte-toi pour continuer.");
    sub = data.claims.sub;
    email = (data.claims.email as string | undefined) ?? null;
  }
  const household = await loadHousehold(db, sub);
  return { db, userId: sub, email, source: opts.source, clientId: opts.clientId ?? null, household };
}

export function partnerOf(ctx: HouseholdCtx): Member | null {
  return ctx.household.members.find((m) => m.userId !== ctx.userId) ?? null;
}

export function memberName(ctx: HouseholdCtx, userId: string | null | undefined): string {
  if (!userId) return ctx.household.jointAccountName;
  return ctx.household.members.find((m) => m.userId === userId)?.displayName ?? "Ancien membre";
}
