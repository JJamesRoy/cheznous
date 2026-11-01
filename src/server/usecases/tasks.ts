import { z } from "zod";
import { defineOp } from "../op";
import { AppError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import { idempotent, resolveMember, resolveProject, today, zDate, zIdempotencyKey } from "../support";
import { addDays, formatDateFr, relativeDayFr, weekRange } from "../../domain/dates";
import { nextOccurrenceOnOrAfter, type Frequency } from "../../domain/recurrence";

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  kind: "general" | "maintenance";
  assignee: string | null;
  due_on: string | null;
  priority: number;
  tags: string[];
  frequency: Exclude<Frequency, "installments"> | null;
  recurrence_anchor: string | null;
  appliance_id: string | null;
  project_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string;
  created_at: string;
  task_checklist_items: { id: string; label: string; done: boolean; sort: number }[];
};

const TASK_SELECT =
  "id, title, notes, kind, assignee, due_on, priority, tags, frequency, recurrence_anchor, appliance_id, project_id, completed_at, completed_by, created_by, created_at, task_checklist_items(id, label, done, sort)";

export function toTask(ctx: HouseholdCtx, r: TaskRow) {
  const t = today(ctx);
  const checklist = [...(r.task_checklist_items ?? [])].sort((a, b) => a.sort - b.sort);
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    kind: r.kind,
    assignee: r.assignee ? { userId: r.assignee, name: memberName(ctx, r.assignee), isMe: r.assignee === ctx.userId } : null,
    dueOn: r.due_on,
    due: r.due_on ? { label: formatDateFr(r.due_on), relative: relativeDayFr(r.due_on, t), overdue: !r.completed_at && r.due_on < t } : null,
    priority: r.priority as 0 | 1 | 2,
    tags: r.tags,
    frequency: r.frequency,
    applianceId: r.appliance_id,
    projectId: r.project_id,
    completed: !!r.completed_at,
    completedAt: r.completed_at,
    completedBy: r.completed_by ? { userId: r.completed_by, name: memberName(ctx, r.completed_by) } : null,
    checklist,
    checklistDone: checklist.filter((c) => c.done).length,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}
export type TaskDto = ReturnType<typeof toTask>;

async function fetchTask(ctx: HouseholdCtx, id: string): Promise<TaskRow> {
  const row = unwrap(await ctx.db.from("tasks").select(TASK_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle()) as TaskRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Tâche introuvable.");
  return row;
}

export const listTasks = defineOp({
  name: "tasks.list",
  kind: "read",
  input: z.object({
    scope: z.enum(["open", "week", "today", "done", "all"]).default("open"),
    assignee: z.string().max(100).optional(),
    kind: z.enum(["general", "maintenance"]).optional(),
    tag: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  run: async (ctx, input) => {
    const t = today(ctx);
    let q = ctx.db.from("tasks").select(TASK_SELECT).eq("household_id", ctx.household.id);
    let range: { start: string; endExclusive: string } | null = null;
    if (input.scope === "done") q = q.not("completed_at", "is", null);
    else if (input.scope !== "all") q = q.is("completed_at", null);
    if (input.scope === "week") {
      range = weekRange(t, ctx.household.weekStart);
      // This week + anything overdue.
      q = q.lt("due_on", range.endExclusive);
    }
    if (input.scope === "today") q = q.lte("due_on", t);
    if (input.assignee) q = q.eq("assignee", resolveMember(ctx, input.assignee));
    if (input.kind) q = q.eq("kind", input.kind);
    if (input.tag) q = q.contains("tags", [input.tag]);
    q =
      input.scope === "done"
        ? q.order("completed_at", { ascending: false })
        : q.order("due_on", { ascending: true, nullsFirst: false }).order("priority", { ascending: false }).order("created_at");
    const rows = unwrap(await q.limit(input.limit)) as TaskRow[];
    return {
      scope: input.scope,
      week: range ? { start: range.start, end: addDays(range.endExclusive, -1), label: `${formatDateFr(range.start)} – ${formatDateFr(addDays(range.endExclusive, -1))}` } : null,
      tasks: rows.map((r) => toTask(ctx, r)),
    };
  },
});

export const getTask = defineOp({
  name: "tasks.get",
  kind: "read",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const task = toTask(ctx, await fetchTask(ctx, input.id));
    const history = unwrap(
      await ctx.db.from("task_completions").select("id, due_on, completed_by, completed_at").eq("household_id", ctx.household.id).eq("task_id", input.id).order("completed_at", { ascending: false }).limit(50),
    ) as { id: string; due_on: string | null; completed_by: string; completed_at: string }[];
    return { task, history: history.map((h) => ({ ...h, completedByName: memberName(ctx, h.completed_by) })) };
  },
});

const zTaskFields = z.object({
  title: z.string().trim().min(1, "Donne un titre à la tâche.").max(160),
  notes: z.string().max(4000).nullable().optional(),
  kind: z.enum(["general", "maintenance"]).optional(),
  assignee: z.string().max(100).nullable().optional(),
  dueOn: zDate.nullable().optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]).nullable().optional(),
  applianceId: z.string().uuid().nullable().optional(),
  project: z.string().max(100).nullable().optional(),
  checklist: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
});

async function taskPatch(ctx: HouseholdCtx, input: Partial<z.infer<typeof zTaskFields>>, current?: TaskRow) {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.assignee !== undefined) patch.assignee = input.assignee ? resolveMember(ctx, input.assignee) : null;
  if (input.dueOn !== undefined) patch.due_on = input.dueOn;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.tags !== undefined) patch.tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
  if (input.applianceId !== undefined) patch.appliance_id = input.applianceId;
  if (input.project !== undefined) patch.project_id = input.project ? (await resolveProject(ctx, input.project)).id : null;
  if (input.frequency !== undefined) {
    patch.frequency = input.frequency;
    const due = (patch.due_on as string | null | undefined) ?? current?.due_on ?? null;
    if (input.frequency && !due) throw new AppError("VALIDATION", "Une tâche récurrente a besoin d'une date d'échéance.");
    patch.recurrence_anchor = input.frequency ? due : null;
  } else if (input.dueOn !== undefined && current?.frequency) {
    patch.recurrence_anchor = input.dueOn;
  }
  return patch;
}

export const createTask = defineOp({
  name: "tasks.create",
  kind: "write",
  input: zTaskFields.extend({ idempotencyKey: zIdempotencyKey.optional() }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "tasks.create", input, async () => {
      const patch = await taskPatch(ctx, input);
      const row = unwrap(
        await ctx.db.from("tasks").insert({ household_id: ctx.household.id, ...patch }).select("id").single(),
      ) as { id: string };
      if (input.checklist?.length) {
        unwrap(
          await ctx.db.from("task_checklist_items").insert(input.checklist.map((label, i) => ({ household_id: ctx.household.id, task_id: row.id, label, sort: i * 10 }))),
        );
      }
      return { task: toTask(ctx, await fetchTask(ctx, row.id)) };
    }),
});

export const updateTask = defineOp({
  name: "tasks.update",
  kind: "write",
  input: zTaskFields.partial().omit({ checklist: true }).extend({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const current = await fetchTask(ctx, input.id);
    const patch = await taskPatch(ctx, input, current);
    if (Object.keys(patch).length) unwrap(await ctx.db.from("tasks").update(patch).eq("household_id", ctx.household.id).eq("id", input.id));
    return { task: toTask(ctx, await fetchTask(ctx, input.id)) };
  },
});

/**
 * Complete a task. Recurring tasks record the completion and move to their next due date
 * (strictly after the completed occurrence and not in the past); others are closed.
 */
export const completeTask = defineOp({
  name: "tasks.complete",
  kind: "write",
  input: z.object({ id: z.string().uuid(), idempotencyKey: zIdempotencyKey.optional() }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "tasks.complete", input, async () => {
      const cur = await fetchTask(ctx, input.id);
      if (cur.completed_at) return { task: toTask(ctx, cur), nextDueOn: null as string | null };
      unwrap(await ctx.db.from("task_completions").insert({ household_id: ctx.household.id, task_id: cur.id, due_on: cur.due_on, completed_by: ctx.userId }));
      let nextDueOn: string | null = null;
      if (cur.frequency && cur.recurrence_anchor && cur.due_on) {
        const t = today(ctx);
        const after = addDays(cur.due_on > t ? cur.due_on : t, 1);
        nextDueOn = nextOccurrenceOnOrAfter({ frequency: cur.frequency, anchorDate: cur.recurrence_anchor }, after);
        unwrap(await ctx.db.from("tasks").update({ due_on: nextDueOn }).eq("id", cur.id));
        if (cur.task_checklist_items?.length) {
          unwrap(await ctx.db.from("task_checklist_items").update({ done: false }).eq("household_id", ctx.household.id).eq("task_id", cur.id));
        }
      } else {
        unwrap(await ctx.db.from("tasks").update({ completed_at: new Date().toISOString(), completed_by: ctx.userId }).eq("id", cur.id));
      }
      return { task: toTask(ctx, await fetchTask(ctx, cur.id)), nextDueOn };
    }),
});

export const reopenTask = defineOp({
  name: "tasks.reopen",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    await fetchTask(ctx, input.id);
    unwrap(await ctx.db.from("tasks").update({ completed_at: null, completed_by: null }).eq("household_id", ctx.household.id).eq("id", input.id));
    return { task: toTask(ctx, await fetchTask(ctx, input.id)) };
  },
});

export const deleteTask = defineOp({
  name: "tasks.delete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const snapshot = toTask(ctx, await fetchTask(ctx, input.id));
    unwrap(await ctx.db.from("tasks").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { deleted: snapshot };
  },
});

export const checklistAdd = defineOp({
  name: "tasks.checklistAdd",
  kind: "write",
  input: z.object({ taskId: z.string().uuid(), label: z.string().trim().min(1).max(160) }),
  run: async (ctx, input) => {
    const task = await fetchTask(ctx, input.taskId);
    const sort = Math.max(0, ...task.task_checklist_items.map((c) => c.sort)) + 10;
    const row = unwrap(await ctx.db.from("task_checklist_items").insert({ household_id: ctx.household.id, task_id: task.id, label: input.label, sort }).select("id, label, done, sort").single());
    return { item: row as { id: string; label: string; done: boolean; sort: number } };
  },
});

export const checklistToggle = defineOp({
  name: "tasks.checklistToggle",
  kind: "write",
  input: z.object({ id: z.string().uuid(), done: z.boolean() }),
  run: async (ctx, input) => {
    const row = unwrap(await ctx.db.from("task_checklist_items").update({ done: input.done }).eq("household_id", ctx.household.id).eq("id", input.id).select("id, label, done, sort").maybeSingle());
    if (!row) throw new AppError("NOT_FOUND", "Élément introuvable.");
    return { item: row as { id: string; label: string; done: boolean; sort: number } };
  },
});

export const checklistDelete = defineOp({
  name: "tasks.checklistDelete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    unwrap(await ctx.db.from("task_checklist_items").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { ok: true as const };
  },
});
