import { z } from "zod";
import { defineOp, defineUserOp } from "../op";
import { AppError, fromDbError, unwrap } from "../errors";
import { loadHousehold, type HouseholdCtx } from "../ctx";
import { today, zDate } from "../support";
import { monthOf } from "../../domain/dates";

const INVITE_TTL_DAYS = 7;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function householdSummary(ctx: HouseholdCtx) {
  const h = ctx.household;
  return {
    id: h.id,
    name: h.name,
    timezone: h.timezone,
    weekStart: h.weekStart,
    defaultSplitMode: h.defaultSplitMode,
    onboardingStep: h.onboardingStep,
    jointAccount: { id: h.jointAccountId, name: h.jointAccountName },
    me: ctx.userId,
    members: h.members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarPath: m.avatarPath,
      role: m.role,
      incomeWeightBp: m.incomeWeightBp,
      payAnchorDate: m.payAnchorDate,
      isMe: m.userId === ctx.userId,
    })),
  };
}

/** Who am I, which household, members, categories, lists, defaults. The app's boot payload. */
export const getSession = defineUserOp({
  name: "session.get",
  kind: "read",
  input: z.object({}).strict(),
  run: async (ctx) => {
    const profile = unwrap(
      await ctx.db.from("profiles").select("id, display_name, avatar_path").eq("id", ctx.userId).maybeSingle(),
    ) as { id: string; display_name: string; avatar_path: string | null } | null;
    if (!ctx.household) {
      return { user: { id: ctx.userId, email: ctx.email, displayName: profile?.display_name ?? "" }, household: null };
    }
    const hctx = ctx as HouseholdCtx;
    const [categories, lists, projects] = await Promise.all([
      ctx.db.from("budget_categories").select("id, name, kind, sort, archived").eq("household_id", hctx.household.id).order("sort"),
      ctx.db.from("shopping_lists").select("id, name, kind, sort").eq("household_id", hctx.household.id).eq("archived", false).order("sort"),
      ctx.db.from("projects").select("id, name, status, budget_cents").eq("household_id", hctx.household.id).neq("status", "archived").order("created_at"),
    ]);
    return {
      user: { id: ctx.userId, email: ctx.email, displayName: profile?.display_name ?? "" },
      household: householdSummary(hctx),
      categories: unwrap(categories) as { id: string; name: string; kind: "fixed" | "variable"; sort: number; archived: boolean }[],
      lists: unwrap(lists) as { id: string; name: string; kind: string; sort: number }[],
      projects: unwrap(projects) as { id: string; name: string; status: string; budget_cents: number | null }[],
      today: today(hctx),
      month: monthOf(today(hctx)),
    };
  },
});

export const updateProfile = defineUserOp({
  name: "profile.update",
  kind: "write",
  input: z.object({
    displayName: z.string().trim().min(1, "Ton prénom est requis.").max(60),
    avatarPath: z.string().max(300).nullable().optional(),
  }),
  run: async (ctx, input) => {
    const patch: Record<string, unknown> = { display_name: input.displayName };
    if (input.avatarPath !== undefined) {
      if (input.avatarPath && !input.avatarPath.startsWith(`avatars/${ctx.userId}/`)) {
        throw new AppError("FORBIDDEN", "Chemin d'avatar invalide.");
      }
      patch.avatar_path = input.avatarPath;
    }
    unwrap(await ctx.db.from("profiles").update(patch).eq("id", ctx.userId));
    return { ok: true as const };
  },
});

export const createHousehold = defineUserOp({
  name: "household.create",
  kind: "write",
  input: z.object({
    name: z.string().trim().min(1, "Donne un nom à ton foyer.").max(80),
    displayName: z.string().trim().min(1, "Ton prénom est requis.").max(60),
  }),
  run: async (ctx, input) => {
    unwrap(await ctx.db.from("profiles").update({ display_name: input.displayName }).eq("id", ctx.userId));
    const res = await ctx.db.rpc("create_household", { p_name: input.name });
    if (res.error) throw fromDbError(res.error);
    return { householdId: res.data as string };
  },
});

export const createInvitation = defineOp({
  name: "household.invite",
  kind: "write",
  input: z.object({}).strict(),
  run: async (ctx) => {
    if (ctx.household.members.length >= 2) {
      throw new AppError("CONFLICT", "Ton foyer compte déjà deux membres.");
    }
    // Revoke previous pending invitations: only one live link at a time.
    unwrap(
      await ctx.db
        .from("household_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("household_id", ctx.household.id)
        .is("accepted_at", null)
        .is("revoked_at", null),
    );
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
    unwrap(
      await ctx.db.from("household_invitations").insert({
        household_id: ctx.household.id,
        token_hash: await sha256Hex(token),
        expires_at: expiresAt,
        created_by: ctx.userId,
      }),
    );
    // The raw token exists only in this response and in the link the user shares.
    return { token, expiresAt, path: `/rejoindre/${token}` };
  },
});

export const pendingInvitation = defineOp({
  name: "household.pendingInvitation",
  kind: "read",
  input: z.object({}).strict(),
  run: async (ctx) => {
    const rows = unwrap(
      await ctx.db
        .from("household_invitations")
        .select("id, created_at, expires_at")
        .eq("household_id", ctx.household.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    ) as { id: string; created_at: string; expires_at: string }[];
    return { pending: rows[0] ?? null };
  },
});

export const revokeInvitation = defineOp({
  name: "household.revokeInvitation",
  kind: "write",
  input: z.object({}).strict(),
  run: async (ctx) => {
    unwrap(
      await ctx.db
        .from("household_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("household_id", ctx.household.id)
        .is("accepted_at", null)
        .is("revoked_at", null),
    );
    return { ok: true as const };
  },
});

export const invitationPreview = defineUserOp({
  name: "invitation.preview",
  kind: "read",
  input: z.object({ token: z.string().min(16).max(200) }),
  run: async (ctx, input) => {
    const res = await ctx.db.rpc("invitation_preview", { p_token: input.token });
    if (res.error) throw fromDbError(res.error);
    const row = (res.data as { household_name: string | null; inviter_name: string | null; expires_at: string | null; status: string }[])[0];
    return {
      status: (row?.status ?? "invalid") as "valid" | "invalid" | "expired" | "used" | "revoked",
      householdName: row?.household_name ?? null,
      inviterName: row?.inviter_name ?? null,
      expiresAt: row?.expires_at ?? null,
    };
  },
});

export const acceptInvitation = defineUserOp({
  name: "invitation.accept",
  kind: "write",
  input: z.object({
    token: z.string().min(16).max(200),
    displayName: z.string().trim().min(1).max(60).optional(),
  }),
  run: async (ctx, input) => {
    if (input.displayName) {
      unwrap(await ctx.db.from("profiles").update({ display_name: input.displayName }).eq("id", ctx.userId));
    }
    const res = await ctx.db.rpc("accept_invitation", { p_token: input.token });
    if (res.error) throw fromDbError(res.error);
    return { householdId: res.data as string };
  },
});

export const updateHouseholdSettings = defineOp({
  name: "household.updateSettings",
  kind: "write",
  input: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    defaultSplitMode: z.enum(["equal", "income"]).optional(),
    weekStart: z.number().int().min(0).max(6).optional(),
    onboardingStep: z.enum(["invite", "ratio", "condo", "expense", "done"]).optional(),
    /** Income ratio in basis points per member; must total 10 000. */
    incomeWeightsBp: z.record(z.string().uuid(), z.number().int().min(0).max(10000)).optional(),
    payAnchors: z.record(z.string().uuid(), zDate.nullable()).optional(),
  }),
  run: async (ctx, input) => {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.defaultSplitMode !== undefined) patch.default_split_mode = input.defaultSplitMode;
    if (input.weekStart !== undefined) patch.week_start = input.weekStart;
    if (input.onboardingStep !== undefined) patch.onboarding_step = input.onboardingStep;
    if (Object.keys(patch).length) unwrap(await ctx.db.from("households").update(patch).eq("id", ctx.household.id));

    const memberIds = new Set(ctx.household.members.map((m) => m.userId));
    if (input.incomeWeightsBp) {
      const entries = Object.entries(input.incomeWeightsBp);
      if (entries.some(([id]) => !memberIds.has(id))) throw new AppError("VALIDATION", "Membre inconnu dans le ratio.");
      if (entries.length !== memberIds.size || entries.reduce((s, [, v]) => s + v, 0) !== 10000) {
        throw new AppError("VALIDATION", "Le ratio doit totaliser 100 % entre les membres.");
      }
      for (const [userId, bp] of entries) {
        unwrap(await ctx.db.from("household_members").update({ income_weight_bp: bp }).eq("household_id", ctx.household.id).eq("user_id", userId));
      }
    }
    if (input.payAnchors) {
      for (const [userId, date] of Object.entries(input.payAnchors)) {
        if (!memberIds.has(userId)) throw new AppError("VALIDATION", "Membre inconnu.");
        unwrap(await ctx.db.from("household_members").update({ pay_anchor_date: date }).eq("household_id", ctx.household.id).eq("user_id", userId));
      }
    }
    const fresh = await loadHousehold(ctx.db, ctx.userId);
    return { household: householdSummary({ ...ctx, household: fresh! }) };
  },
});

export const listCategories = defineOp({
  name: "categories.list",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().optional() }),
  run: async (ctx, input) => {
    let q = ctx.db.from("budget_categories").select("id, name, kind, sort, archived").eq("household_id", ctx.household.id).order("sort");
    if (!input.includeArchived) q = q.eq("archived", false);
    return { categories: unwrap(await q) as { id: string; name: string; kind: string; sort: number; archived: boolean }[] };
  },
});

export const upsertCategory = defineOp({
  name: "categories.upsert",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60),
    kind: z.enum(["fixed", "variable"]).default("variable"),
    archived: z.boolean().optional(),
  }),
  run: async (ctx, input) => {
    if (input.id) {
      const row = unwrap(
        await ctx.db
          .from("budget_categories")
          .update({ name: input.name, kind: input.kind, ...(input.archived !== undefined ? { archived: input.archived } : {}) })
          .eq("household_id", ctx.household.id)
          .eq("id", input.id)
          .select("id")
          .maybeSingle(),
      );
      if (!row) throw new AppError("NOT_FOUND", "Catégorie introuvable.");
      return { id: input.id };
    }
    const max = unwrap(
      await ctx.db.from("budget_categories").select("sort").eq("household_id", ctx.household.id).order("sort", { ascending: false }).limit(1),
    ) as { sort: number }[];
    const row = unwrap(
      await ctx.db
        .from("budget_categories")
        .insert({ household_id: ctx.household.id, name: input.name, kind: input.kind, sort: (max[0]?.sort ?? 0) + 10 })
        .select("id")
        .single(),
    ) as { id: string };
    return { id: row.id };
  },
});
