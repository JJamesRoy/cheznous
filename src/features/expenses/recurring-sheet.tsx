"use client";

import { ArrowLeft, Lock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  Button,
  ChipGroup,
  ConfirmDialog,
  DateInput,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  Row,
  SegmentedControl,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  Switch,
} from "@/components/ui";
import { addDays } from "@/domain/dates";
import { FREQUENCY_LABELS_FR, type Frequency } from "@/domain/recurrence";
import { ApiError, type OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { useMembers, useSession } from "@/features/app/session";

type Rule = OpOutput<"recurring.list">["rules"][number];
type Kind = "bill" | "expense";

const FREQUENCIES = Object.keys(FREQUENCY_LABELS_FR) as Frequency[];
const NONE = "__none";

export type RecurringSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight on a new rule of this kind. */
  startWith?: "list" | Kind;
  /** Personal budget: only my private rules, and new rules are private. */
  personal?: boolean;
};

/**
 * Bills (reminders on Accueil · À venir) and recurring expenses (added automatically on their
 * due date). Supports every frequency, including « Aux deux mois » and fixed instalment dates.
 */
export function RecurringSheet({ open, onOpenChange, startWith = "list", personal = false }: RecurringSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={personal ? "Mes récurrences perso" : "Récurrences"}
      description={personal ? "Tes dépenses privées qui reviennent (gym, abonnements…). Ton ou ta partenaire ne les voit pas." : "Factures à venir et dépenses ajoutées automatiquement."}
      desktop="panel"
    >
      {open ? <RecurringBody startWith={startWith} personal={personal} /> : null}
    </Sheet>
  );
}

function RecurringBody({ startWith, personal }: { startWith: "list" | Kind; personal: boolean }) {
  const [editing, setEditing] = useState<{ rule: Rule | null; kind: Kind } | null>(startWith === "list" ? null : { rule: null, kind: startWith });
  if (editing)
    return <RuleForm key={editing.rule?.id ?? "new"} rule={editing.rule} kind={editing.kind} personal={personal} onBack={() => setEditing(null)} />;
  return <RuleList personal={personal} onEdit={(rule) => setEditing({ rule, kind: rule.kind })} onNew={(kind) => setEditing({ rule: null, kind })} />;
}

function RuleList({ personal, onEdit, onNew }: { personal: boolean; onEdit: (r: Rule) => void; onNew: (k: Kind) => void }) {
  const q = useOp("recurring.list", personal ? { isPrivate: true } : {});
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton shape="card" className="h-[52px] w-full" />
        <Skeleton shape="card" className="h-[52px] w-full" />
        <Skeleton shape="card" className="h-[52px] w-full" />
      </div>
    );
  if (q.error)
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-base text-fg-muted">
        {q.error.message}
        <Button size="sm" onClick={() => q.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  const rules = q.data.rules;
  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        personal ? (
          <EmptyState
            message="Aucune dépense perso récurrente. Ajoute ton gym, tes abonnements ou ton cellulaire."
            action={
              <Button variant="primary" onClick={() => onNew("expense")}>
                Ajouter une dépense perso récurrente
              </Button>
            }
          />
        ) : (
          <EmptyState
            message="Aucune facture ni dépense récurrente. Ajoute Hydro-Québec, les frais de condo ou la taxe scolaire."
            action={
              <Button variant="primary" onClick={() => onNew("bill")}>
                Ajouter une facture récurrente
              </Button>
            }
          />
        )
      ) : (
        <ListGroup as="ul" aria-label="Récurrences">
          {rules.map((r) => (
            <li key={r.id}>
              <Row
                onClick={() => onEdit(r)}
                title={r.title}
                description={[
                  r.isPrivate && !personal ? "perso" : null,
                  r.frequencyLabel,
                  r.next ? `prochaine ${r.next.relative}` : null,
                  r.kind === "expense" ? (r.autoCreate ? "ajout auto" : "dépense") : "rappel",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={r.amountCents !== null ? <Money cents={r.amountCents} className="text-base text-fg" /> : <span className="text-sm text-fg-subtle">Montant variable</span>}
              />
            </li>
          ))}
        </ListGroup>
      )}
      {rules.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onNew("bill")}>
            <Plus aria-hidden /> Facture
          </Button>
          <Button onClick={() => onNew("expense")}>
            <Plus aria-hidden /> Dépense récurrente
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RuleForm({ rule, kind: initialKind, personal, onBack }: { rule: Rule | null; kind: Kind; personal: boolean; onBack: () => void }) {
  const session = useSession();
  const { me, partner, members, joint } = useMembers();
  const ids = members.map((m) => m.userId);
  const tpl = rule?.template as { payer?: string } | undefined;
  const [kind, setKind] = useState<Kind>(rule?.kind ?? initialKind);
  const [title, setTitle] = useState(rule?.title ?? "");
  const [amount, setAmount] = useState(rule?.amountCents != null ? centsToInput(rule.amountCents) : "");
  const [amountCents, setAmountCents] = useState<number | null>(rule?.amountCents ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(rule?.category?.id ?? null);
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "monthly");
  const [anchor, setAnchor] = useState(rule?.anchorDate ?? session.today);
  const [dates, setDates] = useState<string[]>(rule?.installmentDates?.length ? rule.installmentDates : [session.today]);
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [payer, setPayer] = useState<string>(tpl?.payer && (tpl.payer === "commun" || ids.includes(tpl.payer)) ? tpl.payer : "commun");
  const [autoCreate, setAutoCreate] = useState(rule?.autoCreate ?? initialKind === "expense");
  const [isPrivate, setIsPrivate] = useState(rule?.isPrivate ?? personal);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useOpMutation("recurring.upsert", {
    onSuccess: () => {
      haptic("success");
      onBack();
    },
    onError: (e) => setError(e.message),
  });
  const del = useOpMutation("recurring.delete", { onSuccess: onBack });

  function submit() {
    setError(null);
    if (!title.trim()) return setError("Donne un nom à la récurrence.");
    if (kind === "expense" && autoCreate && !amountCents) return setError("Un montant est requis pour ajouter la dépense automatiquement.");
    const clean = [...new Set(dates.filter(Boolean))].sort();
    if (frequency === "installments" && clean.length === 0) return setError("Ajoute au moins une date de versement.");
    save.mutate({
      ...(rule ? { id: rule.id } : {}),
      kind,
      title: title.trim(),
      amount: amountCents ? { cents: amountCents } : null,
      category: categoryId,
      frequency,
      anchorDate: frequency === "installments" ? clean[0] : anchor,
      installmentDates: frequency === "installments" ? clean : undefined,
      endDate: endDate || null,
      payer: isPrivate ? me.userId : payer,
      autoCreate: kind === "expense" ? autoCreate : false,
      active: true,
      isPrivate,
    });
  }

  const payerOptions = [
    { value: me.userId, label: "Moi", leading: <Avatar name={me.displayName} size="sm" tone={toneForMember(ids, me.userId).key} className="-ml-2" decorative /> },
    ...(partner ? [{ value: partner.userId, label: partner.displayName, leading: <Avatar name={partner.displayName} size="sm" tone={toneForMember(ids, partner.userId).key} className="-ml-2" decorative /> }] : []),
    { value: "commun", label: joint.name || "Compte commun", leading: <Avatar name="Compte commun" size="sm" tone="joint" className="-ml-2" decorative /> },
  ];

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <button type="button" onClick={onBack} className="-mx-2 -mt-1 flex h-11 items-center gap-1.5 self-start rounded-control px-2 text-base text-fg-muted hover:text-fg md:h-9">
        <ArrowLeft aria-hidden className="size-4" /> Toutes les récurrences
      </button>
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          aria-label="Type"
          value={kind}
          onValueChange={(k) => {
            setKind(k);
            if (k === "expense" && !rule) setAutoCreate(true);
          }}
          options={[
            { value: "bill", label: "Facture à payer" },
            { value: "expense", label: "Dépense récurrente" },
          ]}
        />
        <p className="text-sm text-fg-subtle">
          {kind === "bill" ? "Un rappel dans « À venir ». Tu ajoutes la dépense quand tu la paies." : "Ajoutée toute seule le jour de l'échéance (abonnements, frais fixes)."}
        </p>
      </div>
      <Field label="Nom" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hydro-Québec, frais de condo…" maxLength={120} autoFocus />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Montant" hint={kind === "bill" ? "Facultatif si le montant varie" : undefined}>
          <MoneyInput
            value={amount}
            onValueChange={(t, c) => {
              setAmount(t);
              setAmountCents(c);
            }}
          />
        </Field>
        <Field label="Catégorie">
          <Select
            value={categoryId ?? NONE}
            onValueChange={(v) => setCategoryId(v === NONE ? null : v)}
            options={[{ value: NONE, label: "Sans catégorie" }, ...session.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
      </div>
      <Field label="Fréquence">
        <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)} options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS_FR[f] }))} />
      </Field>
      {frequency === "installments" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-fg">Dates de versement</legend>
          {dates.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <DateInput aria-label={`Versement ${i + 1}`} value={d} onValueChange={(v) => setDates(dates.map((x, j) => (j === i ? v : x)))} />
              <IconButton label={`Retirer le versement ${i + 1}`} size="icon" onClick={() => setDates(dates.filter((_, j) => j !== i))} disabled={dates.length === 1}>
                <X aria-hidden />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={dates.length >= 24}
            onClick={() => setDates([...dates, addDays([...dates].sort().at(-1) ?? session.today, 90)])}
          >
            <Plus aria-hidden /> Ajouter une date
          </Button>
        </fieldset>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prochaine échéance">
            <DateInput value={anchor} onValueChange={(v) => setAnchor(v || session.today)} />
          </Field>
          <Field label="Fin" hint="Facultatif">
            <DateInput value={endDate} onValueChange={setEndDate} />
          </Field>
        </div>
      )}
      <Switch
        label="Perso (privée)"
        description="Payée par toi, jamais partagée, comptée dans ton budget perso. Ton ou ta partenaire ne la voit pas."
        checked={isPrivate}
        onCheckedChange={setIsPrivate}
      />
      {isPrivate ? (
        <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
          <Lock aria-hidden className="size-3.5" /> Payée par toi
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Payé par</span>
          <ChipGroup aria-label="Payé par" value={payer} onValueChange={setPayer} options={payerOptions} layout="scroll" />
        </div>
      )}
      {kind === "expense" ? (
        <Switch label="Ajouter la dépense automatiquement" description="Créée à l'échéance, à la prochaine ouverture de l'app" checked={autoCreate} onCheckedChange={setAutoCreate} />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        {rule ? (
          <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Supprimer
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={save.isPending}>
          Enregistrer
        </Button>
      </SheetFooter>
      {rule ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Supprimer « ${rule.title} » ?`}
          description="Les dépenses déjà ajoutées restent. Les prochaines échéances disparaissent."
          confirmLabel="Supprimer"
          destructive
          onConfirm={async () => {
            try {
              await del.mutateAsync({ id: rule.id });
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Suppression impossible.");
            }
          }}
        />
      ) : null}
    </form>
  );
}
