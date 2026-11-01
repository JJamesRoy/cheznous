"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Field, Sheet, SheetFooter, Textarea, toast } from "@/components/ui";
import type { QuickAddSheetProps } from "@/features/app/quick-add-sheets";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { draftError, emptyDraft, TaskFields, type TaskDraft } from "./task-fields";

/** Quick add task: title, who, when, recurrence, checklist, tags. */
export function QuickAddTask({ open, onOpenChange, prefill }: QuickAddSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nouvelle tâche">
      {open ? <QuickAddTaskForm prefill={prefill} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function QuickAddTaskForm({ prefill, onDone }: { prefill?: Record<string, unknown>; onDone: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    ...emptyDraft(),
    title: typeof prefill?.title === "string" ? prefill.title : "",
    dueOn: typeof prefill?.dueOn === "string" ? prefill.dueOn : "",
    maintenance: prefill?.kind === "maintenance",
  }));
  const [checklist, setChecklist] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);

  const create = useOpMutation("tasks.create", {
    onSuccess: () => {
      haptic("success");
      if (!pathname.startsWith("/taches")) {
        toast("Tâche ajoutée", { description: draft.title.trim(), action: { label: "Voir", onClick: () => router.push("/taches") } });
      }
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        setShowErrors(true);
        if (draftError(draft)) return;
        setError(null);
        create.mutate({
          title: draft.title.trim(),
          notes: draft.notes.trim() || null,
          assignee: draft.assignee,
          dueOn: draft.dueOn || null,
          priority: draft.priority,
          frequency: draft.frequency,
          tags: draft.tags,
          kind: draft.maintenance ? "maintenance" : "general",
          checklist: checklist
            .split("\n")
            .map((l) => l.replace(/^[-*•]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 50),
          idempotencyKey: key,
        });
      }}
    >
      <TaskFields
        draft={draft}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        autoFocusTitle
        showErrors={showErrors}
        collapsible
        extra={
          <Field label="Liste de vérification" hint="Une ligne par élément.">
            <Textarea value={checklist} onChange={(e) => setChecklist(e.target.value)} rows={2} placeholder={"Acheter le filtre\nInstaller"} />
          </Field>
        }
      />
      {error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Ajouter la tâche
        </Button>
      </SheetFooter>
    </form>
  );
}
