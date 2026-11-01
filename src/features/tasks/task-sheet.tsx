"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Checkbox, IconButton, Input, SectionHeader, Sheet, SheetFooter, SkeletonText } from "@/components/ui";
import { formatDateFr, todayIn } from "@/domain/dates";
import { useSession } from "@/features/app/session";
import { useOp, useOpMutation } from "@/lib/data/query";
import { draftError, TaskFields, type TaskDraft } from "./task-fields";
import type { Task } from "./shared";

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** Task detail: edit everything, checklist, completion history, delete. */
export function TaskSheet({
  taskId,
  open,
  onOpenChange,
  onDelete,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (task: Task) => void;
}) {
  const q = useOp("tasks.get", { id: taskId ?? "" }, { enabled: !!taskId && open });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Tâche" desktop="panel">
      {q.error ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-base text-fg-muted">
          <p>{q.error.message}</p>
          <Button size="sm" onClick={() => q.refetch()}>
            Réessayer
          </Button>
        </div>
      ) : !q.data ? (
        <div className="flex flex-col gap-4" aria-busy>
          <SkeletonText className="w-20" size="sm" />
          <SkeletonText className="w-full" size="md" />
          <SkeletonText className="w-2/3" size="md" />
        </div>
      ) : (
        <TaskEditor
          key={q.data.task.id}
          task={q.data.task}
          history={q.data.history}
          onDone={() => onOpenChange(false)}
          onDelete={(t) => {
            onOpenChange(false);
            onDelete(t);
          }}
        />
      )}
    </Sheet>
  );
}

function TaskEditor({
  task,
  history,
  onDone,
  onDelete,
}: {
  task: Task;
  history: { id: string; due_on: string | null; completed_at: string; completedByName: string }[];
  onDone: () => void;
  onDelete: (task: Task) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: task.title,
    notes: task.notes ?? "",
    assignee: task.assignee?.userId ?? null,
    dueOn: task.dueOn ?? "",
    priority: task.priority,
    frequency: task.frequency,
    tags: task.tags,
    maintenance: task.kind === "maintenance",
  });
  const tz = useSession().household.timezone;
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");

  const update = useOpMutation("tasks.update", { onSuccess: onDone, onError: (e) => setError(e.message) });
  const add = useOpMutation("tasks.checklistAdd", { onError: (e) => setError(e.message) });
  const toggle = useOpMutation("tasks.checklistToggle", { onError: (e) => setError(e.message) });
  const remove = useOpMutation("tasks.checklistDelete", { onError: (e) => setError(e.message) });

  // Optimistic checklist state while the toggle round-trips.
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        setShowErrors(true);
        if (draftError(draft)) return;
        setError(null);
        update.mutate({
          id: task.id,
          title: draft.title.trim(),
          notes: draft.notes.trim() || null,
          assignee: draft.assignee,
          dueOn: draft.dueOn || null,
          priority: draft.priority,
          frequency: draft.frequency,
          tags: draft.tags,
          kind: draft.maintenance ? "maintenance" : "general",
        });
      }}
    >
      <TaskFields draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} showErrors={showErrors} />

      <section className="mt-6 flex flex-col gap-2" aria-label="Liste de vérification">
        <SectionHeader
          as="h3"
          title={
            task.checklist.length ? (
              <>
                Liste de vérification{" "}
                <span className="num text-fg-subtle">
                  {task.checklist.filter((c) => localDone[c.id] ?? c.done).length}/{task.checklist.length}
                </span>
              </>
            ) : (
              "Liste de vérification"
            )
          }
        />
        {task.checklist.length ? (
          <ul className="flex flex-col">
            {task.checklist.map((c) => {
              const done = localDone[c.id] ?? c.done;
              return (
                <li key={c.id} className="flex items-center gap-1">
                  <Checkbox
                    className="min-w-0 flex-1"
                    label={c.label}
                    checked={done}
                    strikeWhenChecked
                    onCheckedChange={(next) => {
                      setLocalDone((m) => ({ ...m, [c.id]: next }));
                      toggle.mutate({ id: c.id, done: next }, { onSettled: () => setLocalDone((m) => without(m, c.id)) });
                    }}
                  />
                  <IconButton label={`Retirer « ${c.label} »`} size="icon-sm" className="text-fg-subtle" onClick={() => remove.mutate({ id: c.id })}>
                    <X aria-hidden />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const label = newItem.trim();
                if (!label) return;
                setNewItem("");
                add.mutate({ taskId: task.id, label });
              }
            }}
            placeholder="Ajouter un élément"
            aria-label="Nouvel élément de la liste"
            maxLength={160}
            enterKeyHint="enter"
            autoComplete="off"
          />
          <IconButton
            label="Ajouter l'élément"
            variant="secondary"
            disabled={!newItem.trim()}
            loading={add.isPending}
            onClick={() => {
              const label = newItem.trim();
              if (!label) return;
              setNewItem("");
              add.mutate({ taskId: task.id, label });
            }}
          >
            <Plus aria-hidden />
          </IconButton>
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-2" aria-label="Historique">
        <SectionHeader as="h3" title="Historique" />
        {history.length ? (
          <ul className="flex flex-col gap-1.5 text-sm text-fg-muted">
            {history.slice(0, 12).map((h) => (
              <li key={h.id} className="flex justify-between gap-3">
                <span>Terminée par {h.completedByName}</span>
                <span className="num text-fg-subtle">{formatDateFr(todayIn(tz, new Date(h.completed_at)))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">Jamais terminée pour l&apos;instant.</p>
        )}
        <p className="text-sm text-fg-subtle">Créée le {formatDateFr(todayIn(tz, new Date(task.createdAt)))}{task.dueOn ? ` · échéance ${formatDateFr(task.dueOn)}` : ""}</p>
      </section>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      ) : null}

      <SheetFooter>
        <Button type="button" variant="danger-ghost" onClick={() => onDelete(task)} className="md:mr-auto">
          <Trash2 aria-hidden />
          Supprimer
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          Enregistrer
        </Button>
      </SheetFooter>
    </form>
  );
}
