"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { Plus } from "lucide-react";
import {
  Button,
  ChipGroup,
  EmptyState,
  IconButton,
  ListGroup,
  PullToRefresh,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  toast,
  undoable,
} from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { ApiError, callOp } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp } from "@/lib/data/query";
import { formatDateFr } from "@/domain/dates";
import { useQuickAdd } from "@/features/app/quick-add";
import { useMembers, useSession } from "@/features/app/session";
import { type Task } from "./shared";
import { TaskRow } from "./task-row";
import { TaskSheet } from "./task-sheet";

type Scope = "week" | "open" | "done";
type Who = "me" | "partner" | "all";

const rowMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

export function TasksScreen() {
  const qc = useQueryClient();
  const { today } = useSession();
  const { me, partner } = useMembers();
  const quickAdd = useQuickAdd();
  const [scope, setScope] = useState<Scope>("week");
  const [who, setWho] = useState<Who>("all");
  const assignee = who === "me" ? me.userId : who === "partner" ? partner?.userId : undefined;
  const q = useOp("tasks.list", { scope, assignee });
  const due = useOp("tasks.list", { scope: "today" });

  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [nextDue, setNextDue] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["op"] });
  const unset = (id: string) => setChecking((c) => without(c, id));

  async function onCheck(task: Task, next: boolean) {
    setChecking((c) => ({ ...c, [task.id]: next }));
    try {
      if (next) {
        const r = await callOp("tasks.complete", { id: task.id, idempotencyKey: newIdempotencyKey() });
        if (r.nextDueOn) {
          const nextOn = r.nextDueOn;
          setNextDue((n) => ({ ...n, [task.id]: nextOn }));
          await refresh();
          // Visible on the row unless the next occurrence leaves the current week view.
          if (scope === "week" && q.data?.week && nextOn > q.data.week.end) {
            toast(`« ${task.title} » terminée`, { description: `Prochaine : ${formatDateFr(nextOn)}` });
          }
        } else {
          await refresh();
          undoable(`« ${task.title} » terminée`, async () => {
            await callOp("tasks.reopen", { id: task.id }).catch((e) => toast.error(errMsg(e, "Impossible de rouvrir la tâche.")));
            await refresh();
          });
        }
      } else {
        await callOp("tasks.reopen", { id: task.id });
        setNextDue((n) => without(n, task.id));
        await refresh();
      }
    } catch (e) {
      toast.error(errMsg(e, "Impossible de mettre à jour la tâche."));
    } finally {
      unset(task.id);
    }
  }

  async function onDelete(task: Task) {
    try {
      const r = await callOp("tasks.delete", { id: task.id });
      await refresh();
      const d = r.deleted;
      undoable(`« ${d.title} » supprimée`, async () => {
        try {
          await callOp("tasks.create", {
            title: d.title,
            notes: d.notes,
            kind: d.kind,
            assignee: d.assignee?.userId ?? null,
            dueOn: d.dueOn,
            priority: d.priority,
            tags: d.tags,
            frequency: d.frequency,
            project: d.projectId,
            applianceId: d.applianceId,
            checklist: d.checklist.map((c) => c.label),
          });
          await refresh();
        } catch (e) {
          toast.error(errMsg(e, "Impossible de restaurer la tâche."));
        }
      });
    } catch (e) {
      toast.error(errMsg(e, "Impossible de supprimer la tâche."));
    }
  }

  const overdueCount = due.data?.tasks.filter((t) => t.due?.overdue).length ?? 0;
  const todayCount = due.data?.tasks.filter((t) => t.dueOn === today).length ?? 0;

  const tasks = q.data?.tasks ?? [];
  const groups: { id: string; title: string; tasks: Task[] }[] =
    scope === "done"
      ? [{ id: "done", title: "", tasks }].filter((g) => g.tasks.length > 0)
      : [
          { id: "late", title: "En retard", tasks: tasks.filter((t) => t.dueOn && t.dueOn < today) },
          { id: "today", title: "Aujourd'hui", tasks: tasks.filter((t) => t.dueOn === today) },
          { id: "later", title: scope === "week" ? "Plus tard cette semaine" : "À venir", tasks: tasks.filter((t) => t.dueOn && t.dueOn > today) },
          { id: "none", title: "Sans date", tasks: tasks.filter((t) => !t.dueOn) },
        ].filter((g) => g.tasks.length > 0);

  const newTask = () => quickAdd.open("task");
  const empty = {
    week: "Aucune tâche cette semaine.",
    open: "Aucune tâche à faire.",
    done: "Aucune tâche terminée pour l'instant.",
  }[scope];

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader
        title="Tâches"
        description={q.data?.week && scope === "week" ? `Semaine du ${q.data.week.label}` : undefined}
        actions={
          <>
            <IconButton label="Nouvelle tâche" onClick={newTask} className="lg:hidden">
              <Plus aria-hidden />
            </IconButton>
            <Button onClick={newTask} className="hidden lg:inline-flex">
              <Plus aria-hidden />
              Nouvelle tâche
            </Button>
          </>
        }
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-5 lg:mx-0">
        {overdueCount + todayCount > 0 ? (
          <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-card bg-surface px-4 py-3 text-base text-fg-muted">
            {overdueCount > 0 ? (
              <span className="font-medium text-negative">
                {overdueCount} tâche{overdueCount > 1 ? "s" : ""} en retard
              </span>
            ) : null}
            {overdueCount > 0 && todayCount > 0 ? <span aria-hidden>·</span> : null}
            {todayCount > 0 ? (
              <span className="text-fg">
                {todayCount} pour aujourd&apos;hui
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SegmentedControl<Scope>
            aria-label="Période"
            value={scope}
            onValueChange={setScope}
            fill
            className="md:w-auto md:max-w-sm md:flex-1"
            options={[
              {
                value: "week",
                label: (
                  <>
                    <span className="sm:hidden">Semaine</span>
                    <span className="hidden sm:inline">Cette semaine</span>
                  </>
                ),
              },
              { value: "open", label: "Toutes" },
              { value: "done", label: "Terminées" },
            ]}
          />
          <ChipGroup<Who>
            aria-label="Responsable"
            value={who}
            onValueChange={setWho}
            options={[
              { value: "me", label: "Moi" },
              ...(partner ? [{ value: "partner" as const, label: partner.displayName }] : []),
              { value: "all", label: "Tous" },
            ]}
          />
        </div>

        {q.isPending ? (
          <ListGroup aria-label="Chargement des tâches">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex min-h-[60px] items-center gap-3 px-4">
                <Skeleton shape="circle" className="size-5" />
                <span className="flex flex-1 flex-col gap-1">
                  <SkeletonText className="w-48" />
                  <SkeletonText size="sm" className="w-24" />
                </span>
              </div>
            ))}
          </ListGroup>
        ) : q.error ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-base text-fg-muted">
            <p>{q.error.message}</p>
            <Button size="sm" onClick={() => q.refetch()}>
              Réessayer
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            message={empty}
            action={
              scope === "done" ? (
                <Button onClick={() => setScope("week")}>Voir cette semaine</Button>
              ) : (
                <Button variant="primary" onClick={newTask}>
                  <Plus aria-hidden />
                  Nouvelle tâche
                </Button>
              )
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-label={g.title || "Tâches terminées"} className="flex flex-col gap-2">
              {g.title ? (
                <SectionHeader
                  title={
                    <span className={g.id === "late" ? "text-negative" : undefined}>
                      {g.title} <span className="num font-normal text-fg-subtle">{g.tasks.length}</span>
                    </span>
                  }
                />
              ) : null}
              <ListGroup as="ul">
                <AnimatePresence initial={false}>
                  {g.tasks.map((t) => (
                    <m.li key={t.id} {...rowMotion}>
                      <TaskRow
                        task={t}
                        today={today}
                        checked={checking[t.id] ?? t.completed}
                        nextDueOn={nextDue[t.id]}
                        onCheck={onCheck}
                        onOpen={(task) => {
                          setOpenId(task.id);
                          setSheetOpen(true);
                        }}
                        onDelete={onDelete}
                      />
                    </m.li>
                  ))}
                </AnimatePresence>
              </ListGroup>
            </section>
          ))
        )}
      </div>
      <TaskSheet taskId={openId} open={sheetOpen} onOpenChange={setSheetOpen} onDelete={onDelete} />
    </PullToRefresh>
  );
}
