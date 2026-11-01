import { z } from "zod";
import { defineOp } from "../op";
import { AppError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import { idempotent, moneyToCents, resolveGoal, resolveMember, resolveProject, selectAll, today, zIdempotencyKey, zMoney } from "../support";
import { formatMoney } from "../../domain/money";
import { diffMonths, monthOf, type CivilDate } from "../../domain/dates";
import { loadMortgage, loadPrepayments, mortgagePrivilege, NO_MORTGAGE_MESSAGE, zDay, type PrivilegeDto } from "./condo";

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

type GoalKind = "savings" | "mortgage_prepayment";
type GoalRow = {
  id: string;
  name: string;
  kind: GoalKind;
  target_cents: number | null;
  target_date: string | null;
  project_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
type GoalContributionRow = {
  id: string;
  goal_id: string;
  user_id: string;
  amount_cents: number;
  contributed_on: string;
  note: string | null;
  created_at: string;
};
type PrepaymentLite = { amount_cents: number; paid_on: string; paid_by: string | null };

const GOAL_SELECT = "id, name, kind, target_cents, target_date, project_id, archived, created_at, updated_at";
const CONTRIB_SELECT = "id, goal_id, user_id, amount_cents, contributed_on, note, created_at";

const GOAL_KIND_LABELS_FR: Record<GoalKind, string> = {
  savings: "Épargne",
  mortgage_prepayment: "Remboursement anticipé de l'hypothèque",
};

type MortgageContext = {
  privilege: PrivilegeDto | null;
  reason: string | null;
  prepayments: PrepaymentLite[];
};

async function loadMortgageContext(ctx: HouseholdCtx): Promise<MortgageContext> {
  const m = await loadMortgage(ctx);
  if (!m) return { privilege: null, reason: NO_MORTGAGE_MESSAGE, prepayments: [] };
  const prepayments = await loadPrepayments(ctx, m.id);
  const { privilege, reason } = mortgagePrivilege(ctx, m, prepayments);
  return { privilege, reason, prepayments };
}

function perMember(ctx: HouseholdCtx, rows: { user: string | null; cents: number }[]) {
  const byUser = new Map<string | null, number>();
  for (const r of rows) byUser.set(r.user, (byUser.get(r.user) ?? 0) + r.cents);
  const out = ctx.household.members.map((m) => {
    const c = byUser.get(m.userId) ?? 0;
    return { userId: m.userId as string | null, name: m.displayName, isMe: m.userId === ctx.userId, savedCents: c, saved: formatMoney(c) };
  });
  const known = new Set(ctx.household.members.map((m) => m.userId));
  for (const [user, c] of byUser) {
    if (user !== null && known.has(user)) continue;
    out.push({ userId: user, name: user ? memberName(ctx, user) : "Non précisé", isMe: false, savedCents: c, saved: formatMoney(c) });
  }
  return out;
}

function goalDto(
  ctx: HouseholdCtx,
  g: GoalRow,
  contributions: GoalContributionRow[],
  projectNames: Map<string, string>,
  mortgage: MortgageContext | null,
) {
  const t = today(ctx);
  const setAsideCents = contributions.reduce((s, c) => s + Number(c.amount_cents), 0);

  let targetCents = g.target_cents === null ? null : Number(g.target_cents);
  let targetSource: "goal" | "mortgage_privilege" | null = targetCents === null ? null : "goal";
  let targetDate: CivilDate | null = g.target_date;
  let savedCents = setAsideCents;
  let members = perMember(
    ctx,
    contributions.map((c) => ({ user: c.user_id, cents: Number(c.amount_cents) })),
  );
  let mortgageInfo: { privilege: PrivilegeDto | null; reason: string | null; setAsideCents: number; setAside: string; note: string | null } | null = null;

  if (g.kind === "mortgage_prepayment") {
    const p = mortgage?.privilege ?? null;
    if (p) {
      // Progress = prepayments actually made in the current privilege year; the default
      // target is this year's privilege, so "remaining" is the privilege still available.
      const inYear = (mortgage?.prepayments ?? []).filter((x) => x.paid_on >= p.yearStart && x.paid_on < p.yearEndExclusive);
      savedCents = inYear.reduce((s, x) => s + Number(x.amount_cents), 0);
      members = perMember(
        ctx,
        inYear.map((x) => ({ user: x.paid_by, cents: Number(x.amount_cents) })),
      );
      if (targetCents === null) {
        targetCents = p.allowedCents;
        targetSource = "mortgage_privilege";
      }
      if (!targetDate) targetDate = p.yearEnd;
    }
    mortgageInfo = {
      privilege: p,
      reason: mortgage?.reason ?? null,
      setAsideCents,
      setAside: formatMoney(setAsideCents),
      note: p
        ? `Basé sur tes remboursements anticipés de l'année de privilège en cours (du ${p.yearStart} au ${p.yearEnd}). Il te reste ${p.remaining} de privilège.`
        : null,
    };
  }

  const remainingCents = targetCents === null ? null : Math.max(0, targetCents - savedCents);
  const progress = targetCents ? Math.round((savedCents / targetCents) * 10_000) / 10_000 : null;
  const overdue = !!targetDate && targetDate < t && (remainingCents ?? 0) > 0;
  const monthsLeft = targetDate ? Math.max(0, diffMonths(monthOf(t), monthOf(targetDate))) : null;
  const suggestedMonthlyCents =
    remainingCents !== null && remainingCents > 0 && targetDate && targetDate >= t ? Math.ceil(remainingCents / Math.max(1, monthsLeft ?? 1)) : null;

  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    kindLabel: GOAL_KIND_LABELS_FR[g.kind] ?? g.kind,
    archived: g.archived,
    project: g.project_id ? { id: g.project_id, name: projectNames.get(g.project_id) ?? "Projet" } : null,
    targetCents,
    target: targetCents === null ? null : formatMoney(targetCents),
    targetSource,
    targetDate,
    savedCents,
    saved: formatMoney(savedCents),
    remainingCents,
    remaining: remainingCents === null ? null : formatMoney(remainingCents),
    progress,
    reached: targetCents !== null && savedCents >= targetCents,
    monthsLeft,
    overdue,
    suggestedMonthlyCents,
    suggestedMonthly: suggestedMonthlyCents === null ? null : formatMoney(suggestedMonthlyCents),
    members,
    mortgage: mortgageInfo,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
  };
}

async function loadProjectNames(ctx: HouseholdCtx): Promise<Map<string, string>> {
  const rows = unwrap(await ctx.db.from("projects").select("id, name").eq("household_id", ctx.household.id)) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadContributions(ctx: HouseholdCtx, goalId?: string): Promise<GoalContributionRow[]> {
  return selectAll<GoalContributionRow>((from, to) => {
    let q = ctx.db.from("goal_contributions").select(CONTRIB_SELECT).eq("household_id", ctx.household.id);
    if (goalId) q = q.eq("goal_id", goalId);
    return q.order("contributed_on", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  });
}

async function fetchGoal(ctx: HouseholdCtx, id: string): Promise<GoalRow> {
  const row = unwrap(
    await ctx.db.from("savings_goals").select(GOAL_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle(),
  ) as GoalRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Objectif introuvable.");
  return row;
}

async function buildGoal(ctx: HouseholdCtx, g: GoalRow) {
  const [contributions, names, mortgage] = await Promise.all([
    loadContributions(ctx, g.id),
    loadProjectNames(ctx),
    g.kind === "mortgage_prepayment" ? loadMortgageContext(ctx) : Promise.resolve(null),
  ]);
  return { dto: goalDto(ctx, g, contributions, names, mortgage), contributions };
}

function contributionDto(ctx: HouseholdCtx, c: GoalContributionRow) {
  return {
    id: c.id,
    goalId: c.goal_id,
    member: { userId: c.user_id, name: memberName(ctx, c.user_id) },
    amountCents: Number(c.amount_cents),
    amount: formatMoney(Number(c.amount_cents)),
    contributedOn: c.contributed_on,
    note: c.note,
    createdAt: c.created_at,
  };
}

export const listGoals = defineOp({
  name: "goals.list",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().default(false) }),
  run: async (ctx, input) => {
    let q = ctx.db.from("savings_goals").select(GOAL_SELECT).eq("household_id", ctx.household.id);
    if (!input.includeArchived) q = q.eq("archived", false);
    const goals = unwrap(await q.order("created_at", { ascending: true })) as GoalRow[];
    const [contributions, names, mortgage] = await Promise.all([
      loadContributions(ctx),
      loadProjectNames(ctx),
      goals.some((g) => g.kind === "mortgage_prepayment") ? loadMortgageContext(ctx) : Promise.resolve(null),
    ]);
    const byGoal = new Map<string, GoalContributionRow[]>();
    for (const c of contributions) byGoal.set(c.goal_id, [...(byGoal.get(c.goal_id) ?? []), c]);
    return { goals: goals.map((g) => goalDto(ctx, g, byGoal.get(g.id) ?? [], names, mortgage)) };
  },
});

export const getGoal = defineOp({
  name: "goals.get",
  kind: "read",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const { dto, contributions } = await buildGoal(ctx, await fetchGoal(ctx, input.id));
    return { goal: dto, contributions: contributions.map((c) => contributionDto(ctx, c)) };
  },
});

export const upsertGoal = defineOp({
  name: "goals.upsert",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Donne un nom à l'objectif.").max(80).optional(),
    kind: z.enum(["savings", "mortgage_prepayment"]).optional(),
    /** null clears it (for a mortgage prepayment goal: defaults to this year's privilege). */
    target: zMoney.nullable().optional(),
    targetDate: zDay.nullable().optional(),
    /** Project name or id; null unlinks. */
    project: z.string().max(100).nullable().optional(),
  }),
  run: async (ctx, input) => {
    const current = input.id ? await fetchGoal(ctx, input.id) : null;
    if (!current && !input.name) throw new AppError("VALIDATION", "Donne un nom à l'objectif.");
    const row: Record<string, unknown> = {};
    if (input.name !== undefined) row.name = input.name;
    if (input.kind !== undefined) row.kind = input.kind;
    if (input.target !== undefined) {
      if (input.target === null) row.target_cents = null;
      else {
        const c = moneyToCents(input.target);
        if (c <= 0) throw new AppError("VALIDATION", "La cible doit être plus grande que zéro.");
        row.target_cents = c;
      }
    }
    if (input.targetDate !== undefined) row.target_date = input.targetDate;
    if (input.project !== undefined) row.project_id = input.project === null ? null : (await resolveProject(ctx, input.project)).id;

    const saved = (
      current
        ? unwrap(await ctx.db.from("savings_goals").update(row).eq("household_id", ctx.household.id).eq("id", current.id).select(GOAL_SELECT).single())
        : unwrap(await ctx.db.from("savings_goals").insert({ ...row, household_id: ctx.household.id }).select(GOAL_SELECT).single())
    ) as GoalRow;
    return { goal: (await buildGoal(ctx, saved)).dto, created: !current };
  },
});

export const addGoalContribution = defineOp({
  name: "goals.addContribution",
  kind: "write",
  input: z.object({
    /** Goal name or id. */
    goal: z.string().min(1).max(100),
    amount: zMoney,
    member: z.string().max(100).default("moi"),
    contributedOn: zDay.optional(),
    note: z.string().trim().max(500).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "goals.addContribution", input, async () => {
      const goal = await resolveGoal(ctx, input.goal);
      const amountCents = moneyToCents(input.amount);
      if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
      const row = unwrap(
        await ctx.db
          .from("goal_contributions")
          .insert({
            household_id: ctx.household.id,
            goal_id: goal.id,
            user_id: resolveMember(ctx, input.member),
            amount_cents: amountCents,
            contributed_on: input.contributedOn ?? today(ctx),
            note: input.note ?? null,
          })
          .select(CONTRIB_SELECT)
          .single(),
      ) as GoalContributionRow;
      const { dto } = await buildGoal(ctx, await fetchGoal(ctx, goal.id));
      return { contribution: contributionDto(ctx, row), goal: dto };
    }),
});

export const archiveGoal = defineOp({
  name: "goals.archive",
  kind: "write",
  input: z.object({ id: z.string().uuid(), archived: z.boolean().default(true) }),
  run: async (ctx, input) => {
    const row = unwrap(
      await ctx.db
        .from("savings_goals")
        .update({ archived: input.archived })
        .eq("household_id", ctx.household.id)
        .eq("id", input.id)
        .select(GOAL_SELECT)
        .maybeSingle(),
    ) as GoalRow | null;
    if (!row) throw new AppError("NOT_FOUND", "Objectif introuvable.");
    return { goal: (await buildGoal(ctx, row)).dto };
  },
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

type ProjectStatus = "active" | "done" | "archived";
type ProjectRow = {
  id: string;
  name: string;
  budget_cents: number | null;
  status: ProjectStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type ProjectExpenseRow = {
  id: string;
  project_id: string;
  description: string;
  amount_cents: number;
  spent_on: string;
  refunds: { amount_cents: number }[];
};

const PROJECT_SELECT = "id, name, budget_cents, status, notes, created_at, updated_at";
const PROJECT_STATUS_LABELS_FR: Record<ProjectStatus, string> = { active: "En cours", done: "Terminé", archived: "Archivé" };

/** Shared (non-private) expenses linked to projects, net of refunds. */
async function loadProjectExpenses(ctx: HouseholdCtx, projectId?: string): Promise<ProjectExpenseRow[]> {
  return selectAll<ProjectExpenseRow>((from, to) => {
    let q = ctx.db
      .from("expenses")
      .select("id, project_id, description, amount_cents, spent_on, refunds(amount_cents)")
      .eq("household_id", ctx.household.id)
      .eq("is_private", false);
    q = projectId ? q.eq("project_id", projectId) : q.not("project_id", "is", null);
    return q.order("spent_on", { ascending: false }).order("id").range(from, to);
  });
}

const netCents = (e: ProjectExpenseRow) => Number(e.amount_cents) - e.refunds.reduce((s, r) => s + Number(r.amount_cents), 0);

function projectDto(p: ProjectRow, expenses: ProjectExpenseRow[]) {
  const spent = expenses.reduce((s, e) => s + netCents(e), 0);
  const budget = p.budget_cents === null ? null : Number(p.budget_cents);
  const remaining = budget === null ? null : budget - spent;
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    statusLabel: PROJECT_STATUS_LABELS_FR[p.status] ?? p.status,
    notes: p.notes,
    budgetCents: budget,
    budget: budget === null ? null : formatMoney(budget),
    spentCents: spent,
    spent: formatMoney(spent),
    remainingCents: remaining,
    remaining: remaining === null ? null : formatMoney(remaining),
    overBudget: remaining !== null && remaining < 0,
    progress: budget ? Math.round((spent / budget) * 10_000) / 10_000 : null,
    expenseCount: expenses.length,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

async function fetchProject(ctx: HouseholdCtx, id: string): Promise<ProjectRow> {
  const row = unwrap(
    await ctx.db.from("projects").select(PROJECT_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle(),
  ) as ProjectRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Projet introuvable.");
  return row;
}

export const listProjects = defineOp({
  name: "projects.list",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().default(false), status: z.enum(["active", "done", "archived"]).optional() }),
  run: async (ctx, input) => {
    let q = ctx.db.from("projects").select(PROJECT_SELECT).eq("household_id", ctx.household.id);
    if (input.status) q = q.eq("status", input.status);
    else if (!input.includeArchived) q = q.neq("status", "archived");
    const [projects, expenses] = await Promise.all([
      q.order("created_at", { ascending: false }).then((r) => unwrap(r) as ProjectRow[]),
      loadProjectExpenses(ctx),
    ]);
    const byProject = new Map<string, ProjectExpenseRow[]>();
    for (const e of expenses) byProject.set(e.project_id, [...(byProject.get(e.project_id) ?? []), e]);
    return { projects: projects.map((p) => projectDto(p, byProject.get(p.id) ?? [])) };
  },
});

export const getProject = defineOp({
  name: "projects.get",
  kind: "read",
  input: z.object({
    /** Project id or name. */
    id: z.string().min(1).max(100),
  }),
  run: async (ctx, input) => {
    const ref = await resolveProject(ctx, input.id);
    const [project, expenses] = await Promise.all([fetchProject(ctx, ref.id), loadProjectExpenses(ctx, ref.id)]);
    return {
      project: projectDto(project, expenses),
      expenses: expenses.map((e) => {
        const net = netCents(e);
        return {
          id: e.id,
          description: e.description,
          amountCents: Number(e.amount_cents),
          amount: formatMoney(Number(e.amount_cents)),
          netCents: net,
          net: formatMoney(net),
          spentOn: e.spent_on,
        };
      }),
    };
  },
});

export const upsertProject = defineOp({
  name: "projects.upsert",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Donne un nom au projet.").max(80).optional(),
    budget: zMoney.nullable().optional(),
    status: z.enum(["active", "done"]).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
  run: async (ctx, input) => {
    const current = input.id ? await fetchProject(ctx, input.id) : null;
    if (!current && !input.name) throw new AppError("VALIDATION", "Donne un nom au projet.");
    const row: Record<string, unknown> = {};
    if (input.name !== undefined) row.name = input.name;
    if (input.budget !== undefined) row.budget_cents = input.budget === null ? null : moneyToCents(input.budget);
    if (input.status !== undefined) row.status = input.status;
    if (input.notes !== undefined) row.notes = input.notes;
    const saved = (
      current
        ? unwrap(await ctx.db.from("projects").update(row).eq("household_id", ctx.household.id).eq("id", current.id).select(PROJECT_SELECT).single())
        : unwrap(await ctx.db.from("projects").insert({ ...row, household_id: ctx.household.id }).select(PROJECT_SELECT).single())
    ) as ProjectRow;
    return { project: projectDto(saved, await loadProjectExpenses(ctx, saved.id)), created: !current };
  },
});

export const archiveProject = defineOp({
  name: "projects.archive",
  kind: "write",
  input: z.object({ id: z.string().uuid(), archived: z.boolean().default(true) }),
  run: async (ctx, input) => {
    const row = unwrap(
      await ctx.db
        .from("projects")
        .update({ status: input.archived ? "archived" : "active" })
        .eq("household_id", ctx.household.id)
        .eq("id", input.id)
        .select(PROJECT_SELECT)
        .maybeSingle(),
    ) as ProjectRow | null;
    if (!row) throw new AppError("NOT_FOUND", "Projet introuvable.");
    return { project: projectDto(row, await loadProjectExpenses(ctx, row.id)) };
  },
});
