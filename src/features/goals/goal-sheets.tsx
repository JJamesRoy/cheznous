"use client";

import { useState } from "react";
import { Button, ChipGroup, DateInput, Field, Input, Money, MoneyInput, Select, Sheet, SheetFooter } from "@/components/ui";
import { useMembers, useSession } from "@/features/app/session";
import { Note } from "@/features/condo/ui";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import type { Goal } from "./goals-screen";

type Kind = Goal["kind"];

export function GoalSheet({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal: Goal | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={goal ? "Modifier l'objectif" : "Nouvel objectif"}>
      {open ? <GoalForm goal={goal} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function GoalForm({ goal, onDone }: { goal: Goal | null; onDone: () => void }) {
  const { projects } = useSession();
  const [name, setName] = useState(goal?.name ?? "");
  const [kind, setKind] = useState<Kind>(goal?.kind ?? "savings");
  // For a mortgage goal whose target comes from the privilege, the field stays empty.
  const [target, setTarget] = useState(goal?.targetSource === "goal" ? centsToInput(goal.targetCents) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate && goal.targetSource !== "mortgage_privilege" ? goal.targetDate : "");
  const [project, setProject] = useState(goal?.project?.id ?? "none");
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation("goals.upsert");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Donne un nom à l'objectif.");
    setError(null);
    try {
      await save.mutateAsync({
        id: goal?.id,
        name: name.trim(),
        kind,
        target: target.trim() ? target : null,
        targetDate: targetDate || null,
        project: project === "none" ? null : project,
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
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fonds d'urgence" maxLength={80} autoFocus={!goal} />
      </Field>
      <Field label="Type">
        <ChipGroup
          aria-label="Type d'objectif"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "savings", label: "Épargne" },
            { value: "mortgage_prepayment", label: "Remboursement anticipé de l'hypothèque" },
          ]}
        />
      </Field>
      {kind === "mortgage_prepayment" ? (
        <Note>
          La cible est lue automatiquement dans ton hypothèque : c&apos;est ton privilège annuel de remboursement anticipé (par exemple
          15 % du capital d&apos;origine). La progression suit les remboursements anticipés faits pendant l&apos;année de privilège en cours.
          Tu peux quand même fixer ta propre cible.
        </Note>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cible" hint={kind === "mortgage_prepayment" ? "Vide : ton privilège annuel." : "Facultatif"}>
          <MoneyInput value={target} onValueChange={(t) => setTarget(t)} />
        </Field>
        <Field label="D'ici le" hint={kind === "mortgage_prepayment" ? "Vide : fin de l'année de privilège." : "Facultatif"}>
          <DateInput value={targetDate} onValueChange={setTargetDate} />
        </Field>
      </div>
      {projects.length ? (
        <Field label="Projet lié" hint="Facultatif">
          <Select
            value={project}
            onValueChange={setProject}
            options={[{ value: "none", label: "Aucun" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {goal ? "Enregistrer" : "Créer l'objectif"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function ContributionSheet({ goal, onOpenChange }: { goal: Goal | null; onOpenChange: (o: boolean) => void }) {
  const mortgage = goal?.kind === "mortgage_prepayment";
  return (
    <Sheet
      open={goal !== null}
      onOpenChange={onOpenChange}
      title={mortgage ? "Mettre de côté" : `Ajouter à « ${goal?.name ?? ""} »`}
      description={
        mortgage
          ? "Un montant réservé pour ton prochain remboursement anticipé. La progression, elle, compte les remboursements faits au prêteur."
          : "Un montant mis de côté pour cet objectif."
      }
    >
      {goal ? <ContributionForm key={goal.id} goal={goal} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function ContributionForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const { today } = useSession();
  const { members, me } = useMembers();
  const [key] = useState(newIdempotencyKey);
  const [member, setMember] = useState(me.userId);
  const [amount, setAmount] = useState({ text: "", cents: null as number | null });
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useOpMutation("goals.addContribution");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount.cents) return setError("Entre un montant.");
    setError(null);
    try {
      await add.mutateAsync({
        goal: goal.id,
        amount: { cents: amount.cents },
        member,
        contributedOn: date,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Montant"
        error={error}
        hint={
          goal.suggestedMonthlyCents ? (
            <>
              Suggestion : <Money cents={goal.suggestedMonthlyCents} /> par mois
            </>
          ) : undefined
        }
      >
        <MoneyInput value={amount.text} onValueChange={(text, cents) => setAmount({ text, cents })} autoFocus />
      </Field>
      {goal.suggestedMonthlyCents && !amount.text ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-mt-2 self-start"
          onClick={() => setAmount({ text: centsToInput(goal.suggestedMonthlyCents), cents: goal.suggestedMonthlyCents })}
        >
          Utiliser <Money cents={goal.suggestedMonthlyCents!} />
        </Button>
      ) : null}
      <Field label="Qui">
        <ChipGroup
          aria-label="Qui met ce montant de côté"
          value={member}
          onValueChange={setMember}
          options={members.map((m) => ({ value: m.userId, label: m.isMe ? "Moi" : m.displayName }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <DateInput value={date} onValueChange={setDate} max={today} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Ajouter
        </Button>
      </SheetFooter>
    </form>
  );
}
