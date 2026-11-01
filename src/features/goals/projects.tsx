"use client";

import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  ProgressBar,
  SegmentedControl,
  Sheet,
  SheetFooter,
  Skeleton,
  Textarea,
  toast,
  undoable,
} from "@/components/ui";
import { Badge, fmtDate, QueryError, Section } from "@/features/condo/ui";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { centsToInput, formatMoney } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";

type Project = OpOutput<"projects.list">["projects"][number];

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function ProjectsSection() {
  const q = useOp("projects.list", {});
  const [editing, setEditing] = useState<{ project: Project | null } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  return (
    <Section
      title="Projets"
      id="projects"
      description="Les dépenses d'un chantier, regroupées, avec leur budget."
      action={
        q.data?.projects.length ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing({ project: null })}>
            <Plus aria-hidden />
            Nouveau projet
          </Button>
        ) : null
      }
    >
      {q.isPending ? (
        <Skeleton shape="card" className="h-[180px]" />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="les projets" />
      ) : q.data.projects.length === 0 ? (
        <EmptyState
          message="Un projet regroupe les dépenses d'un chantier, comme le salon ou les rénos de cuisine, et suit son budget."
          action={
            <Button variant="primary" onClick={() => setEditing({ project: null })}>
              Créer un projet
            </Button>
          }
        />
      ) : (
        <ListGroup as="ul" aria-label="Projets">
          {q.data.projects.map((p) => (
            <li key={p.id}>
              <ProjectRow p={p} onOpen={() => setDetail(p.id)} />
            </li>
          ))}
        </ListGroup>
      )}

      <ProjectSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} project={editing?.project ?? null} />
      <ProjectDetailSheet
        id={detail}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={(p) => {
          setDetail(null);
          setEditing({ project: p });
        }}
      />
    </Section>
  );
}

function ProjectRow({ p, onOpen }: { p: Project; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable flex w-full flex-col gap-2 border-b border-border px-4 py-3 text-left hover:bg-surface-2 active:bg-surface-pressed focus-visible:-outline-offset-2 [li:last-child>&]:border-b-0"
    >
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base text-fg">{p.name}</span>
          {p.status === "done" ? <Badge>Terminé</Badge> : null}
        </span>
        <span className="shrink-0 text-base">
          <Money cents={p.spentCents} className="text-fg" />
          {p.budgetCents !== null ? (
            <span className="text-fg-subtle">
              {" "}
              / <Money cents={p.budgetCents} />
            </span>
          ) : null}
        </span>
      </span>
      {p.budgetCents ? (
        <ProgressBar
          value={p.spentCents}
          max={p.budgetCents}
          size="sm"
          label={`${p.name} : ${Math.round((p.progress ?? 0) * 100)} % du budget`}
          valueText={`${formatMoney(p.spentCents)} sur ${formatMoney(p.budgetCents)}`}
        />
      ) : null}
      <span className="flex w-full flex-wrap justify-between gap-x-3 text-sm">
        <span className="text-fg-subtle">{p.expenseCount ? plural(p.expenseCount, "dépense", "dépenses") : "Aucune dépense liée"}</span>
        {p.remainingCents !== null ? (
          p.overBudget ? (
            <span className="text-negative">
              dépassé de <Money cents={-p.remainingCents} />
            </span>
          ) : (
            <span className="text-fg-muted">
              reste <Money cents={p.remainingCents} />
            </span>
          )
        ) : (
          <span className="text-fg-subtle">Sans budget</span>
        )}
      </span>
    </button>
  );
}

function ProjectDetailSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (p: Project) => void }) {
  const q = useOp("projects.get", { id: id ?? "" }, { enabled: !!id });
  const upsert = useOpMutation("projects.upsert");
  const archive = useOpMutation("projects.archive");
  const p = q.data?.project;

  return (
    <Sheet open={id !== null} onOpenChange={onOpenChange} title={p?.name ?? "Projet"} description={p?.statusLabel} desktop="panel">
      {!id ? null : q.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16" />
          <Skeleton shape="card" className="h-[200px]" />
        </div>
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="le projet" />
      ) : p ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <Money cents={p.spentCents} className="text-lg font-semibold text-fg" />
              {p.budgetCents !== null ? (
                <span className="text-base text-fg-muted">
                  sur <Money cents={p.budgetCents} />
                </span>
              ) : null}
            </p>
            {p.budgetCents ? (
              <ProgressBar
                value={p.spentCents}
                max={p.budgetCents}
                label={`${p.name} : ${Math.round((p.progress ?? 0) * 100)} % du budget`}
                valueText={`${formatMoney(p.spentCents)} sur ${formatMoney(p.budgetCents)}`}
              />
            ) : null}
            {p.remainingCents !== null ? (
              <p className={cn("text-sm", p.overBudget ? "text-negative" : "text-fg-muted")}>
                {p.overBudget ? "Dépassé de " : "Reste "}
                <Money cents={Math.abs(p.remainingCents)} />
              </p>
            ) : null}
            {p.notes ? <p className="text-base whitespace-pre-line text-fg-muted">{p.notes}</p> : null}
          </div>

          <section className="flex flex-col gap-2" aria-labelledby="proj-exp">
            <h3 id="proj-exp" className="text-sm font-medium text-fg-muted">
              {p.expenseCount ? plural(p.expenseCount, "dépense", "dépenses") : "Dépenses"}
            </h3>
            {q.data.expenses.length === 0 ? (
              <p className="text-base text-fg-subtle">
                Aucune dépense liée. Choisis ce projet quand tu ajoutes une dépense pour la regrouper ici.
              </p>
            ) : (
              <ListGroup as="ul">
                {q.data.expenses.map((e) => (
                  <li key={e.id} className="flex min-h-[52px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base text-fg">{e.description}</span>
                      <span className="text-sm text-fg-subtle">{fmtDate(e.spentOn)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <Money cents={e.netCents} className="text-base text-fg" />
                      {e.netCents !== e.amountCents ? (
                        <span className="text-xs text-fg-subtle">
                          après remb. de <Money cents={e.amountCents - e.netCents} />
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ListGroup>
            )}
            <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
              <Lock aria-hidden className="size-3.5" />
              Les dépenses privées ne sont pas comptées.
            </p>
          </section>

          <SheetFooter>
            <Button
              variant="ghost"
              className="md:mr-auto"
              loading={archive.isPending}
              onClick={async () => {
                try {
                  await archive.mutateAsync({ id: p.id });
                  onOpenChange(false);
                  undoable(`Projet « ${p.name} » archivé`, () => archive.mutateAsync({ id: p.id, archived: false }));
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Archiver
            </Button>
            <Button
              loading={upsert.isPending}
              onClick={async () => {
                try {
                  await upsert.mutateAsync({ id: p.id, status: p.status === "done" ? "active" : "done" });
                  haptic("success");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {p.status === "done" ? "Rouvrir" : "Marquer terminé"}
            </Button>
            <Button variant="primary" onClick={() => onEdit(p)}>
              Modifier
            </Button>
          </SheetFooter>
        </div>
      ) : null}
    </Sheet>
  );
}

function ProjectSheet({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={project ? "Modifier le projet" : "Nouveau projet"}>
      {open ? <ProjectForm project={project} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function ProjectForm({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [budget, setBudget] = useState(centsToInput(project?.budgetCents));
  const [notes, setNotes] = useState(project?.notes ?? "");
  const [status, setStatus] = useState<"active" | "done">(project?.status === "done" ? "done" : "active");
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation("projects.upsert");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Donne un nom au projet.");
    setError(null);
    try {
      await save.mutateAsync({
        id: project?.id,
        name: name.trim(),
        budget: budget.trim() ? budget : null,
        notes: notes.trim() ? notes.trim() : null,
        status,
      });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nom" error={error}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rénos de la cuisine" maxLength={80} autoFocus={!project} />
      </Field>
      <Field label="Budget" hint="Facultatif">
        <MoneyInput value={budget} onValueChange={(t) => setBudget(t)} />
      </Field>
      {project ? (
        <Field label="État">
          <SegmentedControl
            aria-label="État du projet"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "active", label: "En cours" },
              { value: "done", label: "Terminé" },
            ]}
          />
        </Field>
      ) : null}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Soumissions, mesures, idées…" />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {project ? "Enregistrer" : "Créer le projet"}
        </Button>
      </SheetFooter>
    </form>
  );
}
