"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  AssigneePicker,
  Button,
  Chip,
  DateInput,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import { addDays } from "@/domain/dates";
import { useMembers, useSession } from "@/features/app/session";
import {
  FREQUENCY_OPTIONS,
  nextSaturday,
  TASK_PRIORITY_LABELS,
  type TaskFrequency,
} from "./shared";
import { TagsEditor } from "./tags-editor";

export type TaskDraft = {
  title: string;
  notes: string;
  assignee: string | null;
  dueOn: string;
  priority: 0 | 1 | 2;
  frequency: TaskFrequency | null;
  tags: string[];
  maintenance: boolean;
};

export function emptyDraft(): TaskDraft {
  return {
    title: "",
    notes: "",
    assignee: null,
    dueOn: "",
    priority: 0,
    frequency: null,
    tags: [],
    maintenance: false,
  };
}

export function draftError(d: TaskDraft): string | null {
  if (!d.title.trim()) return "Donne un titre à la tâche.";
  if (d.frequency && !d.dueOn)
    return "Une tâche récurrente a besoin d'une date d'échéance.";
  return null;
}

/** Fields shared by the quick-add sheet and the detail sheet. */
export function TaskFields({
  draft,
  onChange,
  autoFocusTitle,
  showErrors,
  collapsible = false,
  extra,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  autoFocusTitle?: boolean;
  showErrors?: boolean;
  /** Quick add: keep priority, tags, kind and notes behind "Plus d'options". */
  collapsible?: boolean;
  /** Extra fields shown with the secondary options (e.g. checklist lines). */
  extra?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const { today } = useSession();
  const { members } = useMembers();
  const quick = [
    { label: "Aujourd'hui", date: today },
    { label: "Demain", date: addDays(today, 1) },
    { label: "Samedi", date: nextSaturday(today) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Titre"
        error={
          showErrors && !draft.title.trim()
            ? "Donne un titre à la tâche."
            : undefined
        }
      >
        <Input
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          autoFocus={autoFocusTitle}
          maxLength={160}
          autoComplete="off"
          placeholder="Ex. : Sortir le recyclage"
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">
          Qui s&apos;en occupe
        </span>
        <AssigneePicker
          people={members.map((m, i) => ({
            id: m.userId,
            name: m.isMe ? `${m.displayName} (moi)` : m.displayName,
            tone: i === 0 ? ("a" as const) : i === 1 ? ("b" as const) : ("neutral" as const),
          }))}
          value={draft.assignee}
          onValueChange={(assignee) => onChange({ assignee })}
          label="Qui s'en occupe"
          showName
        />
      </div>

      <Field
        label="Échéance"
        error={
          showErrors && draft.frequency && !draft.dueOn
            ? "Une tâche récurrente a besoin d'une date."
            : undefined
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <Chip
                key={q.label}
                pressed={draft.dueOn === q.date}
                onClick={() =>
                  onChange({ dueOn: draft.dueOn === q.date ? "" : q.date })
                }
              >
                {q.label}
              </Chip>
            ))}
          </div>
          <DateInput
            value={draft.dueOn}
            onValueChange={(dueOn) => onChange({ dueOn })}
            aria-label="Date d'échéance"
          />
        </div>
      </Field>

      <Field label="Récurrence">
        <Select
          value={draft.frequency ?? "none"}
          onValueChange={(v) =>
            onChange({
              frequency: v === "none" ? null : (v as TaskFrequency),
              ...(v !== "none" && !draft.dueOn ? { dueOn: today } : {}),
            })
          }
          options={FREQUENCY_OPTIONS}
        />
      </Field>

      {!expanded ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start text-fg-muted"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
        >
          <ChevronDown aria-hidden />
          Plus d&apos;options : priorité, liste de vérification, étiquettes
        </Button>
      ) : (
        <>
          <Field label="Priorité">
            <SegmentedControl
              aria-label="Priorité"
              value={String(draft.priority) as "0" | "1" | "2"}
              onValueChange={(v) =>
                onChange({ priority: Number(v) as 0 | 1 | 2 })
              }
              options={([0, 1, 2] as const).map((p) => ({
                value: String(p) as "0" | "1" | "2",
                label: TASK_PRIORITY_LABELS[p],
              }))}
            />
          </Field>

          <Field label="Étiquettes">
            <TagsEditor
              value={draft.tags}
              onChange={(tags) => onChange({ tags })}
            />
          </Field>

          <Switch
            label="Entretien"
            description="Entretien du condo : filtres, joints, détecteurs."
            checked={draft.maintenance}
            onCheckedChange={(maintenance) => onChange({ maintenance })}
          />

          <Field label="Notes">
            <Textarea
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              maxLength={4000}
              rows={2}
            />
          </Field>
          {extra}
        </>
      )}
    </div>
  );
}
