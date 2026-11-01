"use client";

import Link from "next/link";
import { BookOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  DateInput,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  Textarea,
  toast,
} from "@/components/ui";
import { useSession } from "@/features/app/session";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { Badge, fmtDate, QueryError, relativeFr, Section, textOrNull } from "./ui";

type Appliance = OpOutput<"condo.listAppliances">["appliances"][number];
type MTask = OpOutput<"condo.listMaintenance">["tasks"][number];

export function MaintenanceSection() {
  const appliances = useOp("condo.listAppliances", {});
  const maintenance = useOp("condo.listMaintenance", {});
  const [applianceSheet, setApplianceSheet] = useState<{ appliance: Appliance | null } | null>(null);
  const [recordSheet, setRecordSheet] = useState<{ task: MTask | null } | null>(null);
  const [toDelete, setToDelete] = useState<Appliance | null>(null);
  const del = useOpMutation("condo.deleteAppliance");

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      <Section
        title="Électroménagers et équipements"
        id="appl"
        action={
          appliances.data?.appliances.length ? (
            <Button size="sm" variant="ghost" onClick={() => setApplianceSheet({ appliance: null })}>
              <Plus aria-hidden />
              Ajouter
            </Button>
          ) : null
        }
      >
        {appliances.isPending ? (
          <Skeleton shape="card" className="h-[260px]" />
        ) : appliances.error ? (
          <QueryError error={appliances.error} onRetry={() => appliances.refetch()} what="les appareils" />
        ) : appliances.data.appliances.length === 0 ? (
          <EmptyState
            message="Ajoute ton lave-vaisselle, ta thermopompe ou ton chauffe-eau pour suivre leurs garanties."
            action={
              <Button variant="primary" onClick={() => setApplianceSheet({ appliance: null })}>
                Ajouter un appareil
              </Button>
            }
          />
        ) : (
          <ListGroup as="ul">
            {appliances.data.appliances.map((a) => (
              <li key={a.id} className="flex items-start gap-1 border-b border-border py-1 pl-4 last:border-b-0">
                <ApplianceRow a={a} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Options pour ${a.name}`} className="mr-1 text-fg-subtle">
                      <MoreHorizontal aria-hidden />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={<Pencil />} onSelect={() => setApplianceSheet({ appliance: a })}>
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setToDelete(a)}>
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ListGroup>
        )}
      </Section>

      <div className="flex min-w-0 flex-col gap-8">
        <Section
          title="Entretien à faire"
          id="maint-open"
          action={
            <Button asChild size="sm" variant="ghost">
              <Link href="/taches">Voir les tâches</Link>
            </Button>
          }
        >
          {maintenance.isPending ? (
            <Skeleton shape="card" className="h-[120px]" />
          ) : maintenance.error ? (
            <QueryError error={maintenance.error} onRetry={() => maintenance.refetch()} what="l'entretien" />
          ) : (
            <OpenTasks tasks={maintenance.data.tasks.filter((t) => !t.completedAt)} onRecord={(t) => setRecordSheet({ task: t })} />
          )}
        </Section>

        <Section
          title="Historique d'entretien"
          id="maint-hist"
          action={
            <Button size="sm" variant="ghost" onClick={() => setRecordSheet({ task: null })}>
              <Plus aria-hidden />
              Consigner
            </Button>
          }
        >
          {maintenance.isPending ? (
            <Skeleton shape="card" className="h-[200px]" />
          ) : maintenance.error ? null : maintenance.data.history.length === 0 ? (
            <p className="text-base text-fg-subtle">Rien de consigné. Note ici chaque entretien fait, avec son coût.</p>
          ) : (
            <ListGroup as="ul">
              {maintenance.data.history.map((r) => (
                <li key={r.id} className="flex min-h-[52px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base text-fg">{r.title}</span>
                    <span className="truncate text-sm text-fg-subtle">
                      {[fmtDate(r.doneOn), r.appliance?.name, r.createdBy.name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {r.costCents !== null ? <Money cents={r.costCents} className="shrink-0 text-base text-fg" /> : null}
                </li>
              ))}
              {maintenance.data.historyCostCents > 0 ? (
                <li className="flex min-h-11 items-center justify-between px-4 py-2 text-sm text-fg-muted">
                  <span>Total des coûts</span>
                  <Money cents={maintenance.data.historyCostCents} className="font-medium text-fg" />
                </li>
              ) : null}
            </ListGroup>
          )}
        </Section>
      </div>

      <Sheet
        open={applianceSheet !== null}
        onOpenChange={(o) => !o && setApplianceSheet(null)}
        title={applianceSheet?.appliance ? `Modifier ${applianceSheet.appliance.name}` : "Ajouter un appareil"}
        desktop="panel"
      >
        {applianceSheet ? <ApplianceForm a={applianceSheet.appliance} onDone={() => setApplianceSheet(null)} /> : null}
      </Sheet>
      <Sheet open={recordSheet !== null} onOpenChange={(o) => !o && setRecordSheet(null)} title="Consigner un entretien">
        {recordSheet ? (
          <RecordForm task={recordSheet.task} appliances={appliances.data?.appliances ?? []} onDone={() => setRecordSheet(null)} />
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Supprimer ${toDelete?.name ?? ""} ?`}
        description="L'appareil et ses infos de garantie seront retirés pour vous deux. L'historique d'entretien est conservé."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function ApplianceRow({ a }: { a: Appliance }) {
  const w = a.warranty;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
      <span className="truncate text-base text-fg">{a.name}</span>
      {a.brand || a.model ? <span className="truncate text-sm text-fg-subtle">{[a.brand, a.model].filter(Boolean).join(" ")}</span> : null}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {w.status === "active" ? (
          <span className={w.daysLeft !== null && w.daysLeft <= 60 ? "text-warning" : "text-fg-muted"}>
            Garantie jusqu&apos;au {fmtDate(a.warrantyEndsOn)}
          </span>
        ) : w.status === "expired" ? (
          <Badge>Garantie expirée le {fmtDate(a.warrantyEndsOn)}</Badge>
        ) : (
          <span className="text-fg-subtle">Garantie non précisée</span>
        )}
        {a.purchasedOn ? <span className="text-fg-subtle">Acheté le {fmtDate(a.purchasedOn)}</span> : null}
        {a.manualUrl ? (
          <a
            href={a.manualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-fg-muted underline underline-offset-2 hover:text-fg sm:min-h-0"
          >
            <BookOpen aria-hidden className="size-3.5" />
            Manuel
          </a>
        ) : null}
      </span>
    </div>
  );
}

function OpenTasks({ tasks, onRecord }: { tasks: MTask[]; onRecord: (t: MTask) => void }) {
  const { today } = useSession();
  if (tasks.length === 0) return <p className="text-base text-fg-subtle">Aucun entretien en attente.</p>;
  return (
    <ListGroup as="ul">
      {tasks.map((t) => (
        <li key={t.id} className="flex min-h-[52px] items-center gap-3 border-b border-border py-2 pr-2 pl-4 last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base text-fg">{t.title}</span>
            <span className="truncate text-sm">
              {t.dueOn ? (
                <span className={t.overdue ? "text-negative" : t.daysUntil !== null && t.daysUntil <= 7 ? "text-warning" : "text-fg-subtle"}>
                  {t.overdue ? `En retard · prévu le ${fmtDate(t.dueOn)}` : `Prévu ${relativeFr(t.dueOn, today)}`}
                </span>
              ) : (
                <span className="text-fg-subtle">Sans date</span>
              )}
              {t.appliance ? <span className="text-fg-subtle"> · {t.appliance.name}</span> : null}
              {t.assignee ? <span className="text-fg-subtle"> · {t.assignee.name}</span> : null}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onRecord(t)}>
            Consigner
          </Button>
        </li>
      ))}
    </ListGroup>
  );
}

function ApplianceForm({ a, onDone }: { a: Appliance | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: a?.name ?? "",
    brand: a?.brand ?? "",
    model: a?.model ?? "",
    serial: a?.serialNumber ?? "",
    purchasedOn: a?.purchasedOn ?? "",
    warrantyEndsOn: a?.warrantyEndsOn ?? "",
    manualUrl: a?.manualUrl ?? "",
    price: centsToInput(a?.priceCents),
    notes: a?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation("condo.upsertAppliance");
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setError("Donne un nom à l'appareil.");
    if (f.manualUrl.trim() && !/^https?:\/\//i.test(f.manualUrl.trim())) return setError("Le lien du manuel doit commencer par https://.");
    setError(null);
    try {
      await save.mutateAsync({
        id: a?.id,
        name: f.name.trim(),
        brand: textOrNull(f.brand),
        model: textOrNull(f.model),
        serialNumber: textOrNull(f.serial),
        purchasedOn: f.purchasedOn || null,
        warrantyEndsOn: f.warrantyEndsOn || null,
        manualUrl: textOrNull(f.manualUrl),
        price: f.price ? f.price : null,
        notes: textOrNull(f.notes),
      });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nom" required>
        <Input value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Lave-vaisselle" maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Marque">
          <Input value={f.brand} onChange={(e) => set("brand")(e.target.value)} placeholder="Bosch" />
        </Field>
        <Field label="Modèle">
          <Input value={f.model} onChange={(e) => set("model")(e.target.value)} />
        </Field>
      </div>
      <Field label="Numéro de série">
        <Input value={f.serial} onChange={(e) => set("serial")(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date d'achat">
          <DateInput value={f.purchasedOn} onValueChange={set("purchasedOn")} />
        </Field>
        <Field label="Fin de la garantie">
          <DateInput value={f.warrantyEndsOn} onValueChange={set("warrantyEndsOn")} />
        </Field>
      </div>
      <Field label="Prix">
        <MoneyInput value={f.price} onValueChange={(t) => set("price")(t)} />
      </Field>
      <Field label="Lien du manuel">
        <Input type="url" inputMode="url" value={f.manualUrl} onChange={(e) => set("manualUrl")(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Enregistrer
        </Button>
      </SheetFooter>
    </form>
  );
}

function RecordForm({ task, appliances, onDone }: { task: MTask | null; appliances: Appliance[]; onDone: () => void }) {
  const { today } = useSession();
  const [title, setTitle] = useState(task?.title ?? "");
  const [doneOn, setDoneOn] = useState(today);
  const [applianceId, setApplianceId] = useState(task?.appliance?.id ?? "none");
  const [cost, setCost] = useState({ text: "", cents: null as number | null });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useOpMutation("condo.addMaintenanceRecord");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Décris l'entretien fait.");
    setError(null);
    try {
      await add.mutateAsync({
        title: title.trim(),
        doneOn,
        applianceId: applianceId === "none" ? undefined : applianceId,
        taskId: task?.id,
        cost: cost.cents !== null ? { cents: cost.cents } : undefined,
        notes: notes.trim() || undefined,
      });
      haptic("success");
      // The task stays open in Tâches: say so, it isn't visible here.
      if (task) toast("Entretien consigné", { description: "Coche aussi la tâche dans Tâches si elle est terminée." });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Entretien fait" error={error}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nettoyage du filtre de la hotte" maxLength={160} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <DateInput value={doneOn} onValueChange={setDoneOn} />
        </Field>
        <Field label="Coût">
          <MoneyInput value={cost.text} onValueChange={(text, cents) => setCost({ text, cents })} />
        </Field>
      </div>
      {appliances.length ? (
        <Field label="Appareil">
          <Select
            value={applianceId}
            onValueChange={setApplianceId}
            options={[{ value: "none", label: "Aucun" }, ...appliances.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </Field>
      ) : null}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Consigner
        </Button>
      </SheetFooter>
    </form>
  );
}
