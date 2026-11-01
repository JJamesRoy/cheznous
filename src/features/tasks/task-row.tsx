"use client";

import { Check, ListChecks, Repeat, RotateCcw, Trash2, Wrench } from "lucide-react";
import { Checkbox, SwipeRow, type SwipeAction } from "@/components/ui";
import { formatDateFr } from "@/domain/dates";
import { cn } from "@/lib/ui/cn";
import { MetaLine } from "@/features/lists/meta-line";
import { PersonAvatar } from "@/features/lists/person-avatar";
import { dueText, frequencyLabel, TASK_PRIORITY_LABELS, type Task } from "./shared";

export function TaskRow({
  task,
  today,
  checked,
  nextDueOn,
  onCheck,
  onOpen,
  onDelete,
}: {
  task: Task;
  today: string;
  /** Visual state (optimistic). */
  checked: boolean;
  /** Set right after completing a recurring task. */
  nextDueOn?: string | null;
  onCheck: (task: Task, checked: boolean) => void;
  onOpen: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const leading: SwipeAction[] = [
    task.completed
      ? { id: "reopen", label: "Rouvrir", icon: <RotateCcw aria-hidden />, tone: "neutral", onAction: () => onCheck(task, false) }
      : { id: "done", label: "Terminer", icon: <Check aria-hidden />, tone: "accent", onAction: () => onCheck(task, true) },
  ];
  const trailing: SwipeAction[] = [{ id: "delete", label: "Supprimer", icon: <Trash2 aria-hidden />, tone: "danger", onAction: () => onDelete(task) }];

  const meta: React.ReactNode[] = [];
  if (nextDueOn) {
    meta.push(<span key="next" className="font-medium text-fg-muted">Prochaine : {formatDateFr(nextDueOn)}</span>);
  } else if (task.completed && task.completedAt) {
    meta.push(
      <span key="done">
        Terminée{task.completedBy ? ` par ${task.completedBy.name}` : ""}
      </span>,
    );
  } else if (task.dueOn) {
    const d = dueText(task.dueOn, today);
    meta.push(
      <span key="due" className={cn(d.overdue ? "font-medium text-negative" : "text-fg-muted")}>
        {d.text}
      </span>,
    );
  }
  if (task.priority > 0 && !task.completed) {
    meta.push(
      <span key="p" className={cn("font-medium", task.priority === 2 ? "text-fg" : "text-fg-muted")}>
        {TASK_PRIORITY_LABELS[task.priority]}
      </span>,
    );
  }
  if (task.checklist.length) {
    meta.push(
      <span key="cl" className="inline-flex items-center gap-1">
        <ListChecks className="size-3.5" aria-hidden />
        <span className="num">
          {task.checklistDone}/{task.checklist.length}
        </span>
        <span className="sr-only">éléments faits</span>
      </span>,
    );
  }
  const freq = frequencyLabel(task.frequency);
  if (freq) {
    meta.push(
      <span key="f" className="inline-flex items-center gap-1">
        <Repeat className="size-3.5" aria-hidden />
        {freq}
      </span>,
    );
  }
  if (task.kind === "maintenance") {
    meta.push(
      <span key="k" className="inline-flex items-center gap-1">
        <Wrench className="size-3.5" aria-hidden />
        Entretien
      </span>,
    );
  }
  for (const tag of task.tags) meta.push(<span key={`t-${tag}`}>#{tag}</span>);

  return (
    <SwipeRow leadingActions={leading} trailingActions={trailing}>
      <div className="flex min-h-[52px] items-center gap-3 pl-4" data-testid="task-row">
        <Checkbox
          shape="round"
          checked={checked}
          onCheckedChange={(next) => onCheck(task, next)}
          aria-label={task.completed ? `Rouvrir « ${task.title} »` : `Terminer « ${task.title} »`}
        />
        <div className="cn-row-sep relative flex min-w-0 flex-1 items-center gap-2 self-stretch pr-3">
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="flex min-w-0 flex-1 flex-col py-2.5 text-left focus-visible:-outline-offset-2"
          >
            <span className={cn("text-base text-fg", checked && "text-fg-subtle line-through decoration-fg-subtle")}>{task.title}</span>
            <MetaLine items={meta} />
          </button>
          {task.assignee ? <PersonAvatar userId={task.assignee.userId} name={task.assignee.name} className="shrink-0" /> : null}
        </div>
      </div>
    </SwipeRow>
  );
}
