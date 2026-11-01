"use client";

import { Mail, Pencil, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { Button, DateInput, Field, Input, ListGroup, Money, MoneyInput, Sheet, SheetFooter, Skeleton, toast } from "@/components/ui";
import { useSession } from "@/features/app/session";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { PropertyFieldsForm } from "./property-fields-form";
import { Badge, Card, DetailList, fmtDate, QueryError, relativeFr, Section, Unknown } from "./ui";

type Data = OpOutput<"condo.getProperty">;
type Property = NonNullable<Data["property"]>;
type Assessment = Data["assessments"][number];
type SheetKind = "syndicate" | "insurance" | "welcome" | "assessment";

export function SyndicateSection() {
  const q = useOp("condo.getProperty", {});
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2" aria-busy>
        <Skeleton shape="card" className="h-[300px]" />
        <Skeleton shape="card" className="h-[300px]" />
      </div>
    );
  }
  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} what="les infos du syndicat" />;
  const p = q.data.property;
  const edit = (k: SheetKind) => () => setSheet(k);

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <SyndicateCard p={p} onEdit={edit("syndicate")} />
          <Assessments data={q.data} onAdd={edit("assessment")} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <InsuranceCard p={p} onEdit={edit("insurance")} />
          <WelcomeTax p={p} onEdit={edit("welcome")} />
        </div>
      </div>

      <Sheet open={sheet === "syndicate"} onOpenChange={(o) => !o && setSheet(null)} title="Syndicat et frais de condo">
        {sheet === "syndicate" ? (
          <PropertyFieldsForm
            onDone={() => setSheet(null)}
            fields={[
              { key: "syndicateName", label: "Nom du syndicat", type: "text", value: p?.syndicate.name, placeholder: "Syndicat de la copropriété Le Plateau" },
              { key: "managerName", label: "Gestionnaire", type: "text", value: p?.syndicate.managerName, placeholder: "Gestion immobilière ABC" },
              { key: "managerPhone", label: "Téléphone", type: "tel", value: p?.syndicate.managerPhone, half: true },
              { key: "managerEmail", label: "Courriel", type: "email", value: p?.syndicate.managerEmail, half: true },
              { key: "agmDate", label: "Prochaine assemblée générale", type: "date", value: p?.syndicate.agmDate },
              { key: "condoFee", label: "Frais de condo (par mois)", type: "money", value: p?.syndicate.condoFeeCents, half: true },
              {
                key: "condoFeeContingency",
                label: "Dont fonds de prévoyance",
                type: "money",
                value: p?.syndicate.condoFeeContingencyCents,
                half: true,
              },
            ]}
          />
        ) : null}
      </Sheet>
      <Sheet open={sheet === "insurance"} onOpenChange={(o) => !o && setSheet(null)} title="Assurance habitation">
        {sheet === "insurance" ? (
          <PropertyFieldsForm
            onDone={() => setSheet(null)}
            fields={[
              { key: "insurer", label: "Assureur", type: "text", value: p?.insurance.insurer, half: true },
              { key: "insurancePolicyNumber", label: "Numéro de police", type: "text", value: p?.insurance.policyNumber, half: true },
              { key: "insuranceRenewalOn", label: "Renouvellement", type: "date", value: p?.insurance.renewalOn, half: true },
              { key: "insurancePremium", label: "Prime annuelle", type: "money", value: p?.insurance.premiumCents, half: true },
              {
                key: "syndicateDeductible",
                label: "Franchise du syndicat",
                type: "money",
                value: p?.insurance.syndicateDeductibleCents,
                hint: "Inscrite dans l'attestation du syndicat.",
              },
              {
                key: "ownerDeductibleCoverage",
                label: "Ta couverture de la franchise",
                type: "money",
                value: p?.insurance.ownerDeductibleCoverageCents,
                hint: "Le montant que ton assurance paie si le syndicat te réclame sa franchise.",
              },
            ]}
          />
        ) : null}
      </Sheet>
      <Sheet
        open={sheet === "welcome"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Taxe de bienvenue"
        description="Les droits de mutation, facturés par la ville quelques mois après l'achat."
      >
        {sheet === "welcome" ? (
          <PropertyFieldsForm
            onDone={() => setSheet(null)}
            fields={[
              { key: "welcomeTax", label: "Montant", type: "money", value: p?.welcomeTax.amountCents },
              { key: "welcomeTaxDueOn", label: "Échéance", type: "date", value: p?.welcomeTax.dueOn, half: true },
              { key: "welcomeTaxPaidOn", label: "Payée le", type: "date", value: p?.welcomeTax.paidOn, half: true },
            ]}
          />
        ) : null}
      </Sheet>
      <Sheet open={sheet === "assessment"} onOpenChange={(o) => !o && setSheet(null)} title="Cotisation spéciale" description="Un montant exigé par le syndicat en plus des frais de condo.">
        {sheet === "assessment" ? <AssessmentForm onDone={() => setSheet(null)} /> : null}
      </Sheet>
    </>
  );
}

function EditButton({ onClick, label = "Modifier" }: { onClick: () => void; label?: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <Pencil aria-hidden />
      {label}
    </Button>
  );
}

function SyndicateCard({ p, onEdit }: { p: Property | null; onEdit: () => void }) {
  const { today } = useSession();
  const s = p?.syndicate;
  const fee = s?.condoFeeCents ?? null;
  return (
    <Section title="Syndicat" id="syn" action={<EditButton onClick={onEdit} />}>
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-fg-subtle">Frais de condo</span>
          {fee !== null ? (
            <span className="text-lg font-semibold text-fg">
              <Money cents={fee} /> <span className="text-base font-normal text-fg-muted">par mois</span>
            </span>
          ) : (
            <span className="text-base text-fg-muted">Non précisés</span>
          )}
          {s?.condoFeeContingencyCents ? (
            <span className="text-sm text-fg-muted">
              dont <Money cents={s.condoFeeContingencyCents} /> au fonds de prévoyance
              {fee ? ` (${Math.round((s.condoFeeContingencyCents / fee) * 100)} %)` : ""}
            </span>
          ) : null}
        </div>
        <DetailList
          className="sm:grid-cols-1"
          items={[
            { label: "Syndicat", value: s?.name ?? <Unknown /> },
            { label: "Gestionnaire", value: s?.managerName ?? <Unknown /> },
            {
              label: "Assemblée générale",
              value: s?.agmDate ? fmtDate(s.agmDate) : <Unknown>Date à venir</Unknown>,
              hint: s?.agmDate ? relativeFr(s.agmDate, today) : undefined,
            },
          ]}
        />
        {s?.managerPhone || s?.managerEmail ? (
          <div className="flex flex-wrap gap-2">
            {s.managerPhone ? (
              <Button asChild size="sm">
                <a href={`tel:${s.managerPhone.replace(/[^\d+]/g, "")}`}>
                  <Phone aria-hidden />
                  {s.managerPhone}
                </a>
              </Button>
            ) : null}
            {s.managerEmail ? (
              <Button asChild size="sm" className="max-w-full">
                <a href={`mailto:${s.managerEmail}`}>
                  <Mail aria-hidden />
                  <span className="truncate">{s.managerEmail}</span>
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </Section>
  );
}

function statusBadge(a: Assessment, today: string) {
  if (a.status === "paid") return <Badge>Payée le {fmtDate(a.paidOn)}</Badge>;
  if (a.status === "overdue") return <Badge tone="negative">En retard · {fmtDate(a.dueOn)}</Badge>;
  if (a.status === "upcoming") return <Badge tone={a.daysUntilDue !== null && a.daysUntilDue <= 30 ? "warning" : "neutral"}>Due {relativeFr(a.dueOn!, today)}</Badge>;
  return <Badge>Échéance à préciser</Badge>;
}

function Assessments({ data, onAdd }: { data: Data; onAdd: () => void }) {
  const { today } = useSession();
  const mark = useOpMutation("condo.upsertSpecialAssessment");
  return (
    <Section
      title="Cotisations spéciales"
      id="syn-sa"
      action={
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus aria-hidden />
          Ajouter
        </Button>
      }
    >
      {data.assessments.length === 0 ? (
        <p className="text-base text-fg-subtle">Aucune cotisation spéciale. Tant mieux.</p>
      ) : (
        <ListGroup as="ul">
          {data.assessments.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-base text-fg">{a.title}</span>
                <Money cents={a.amountCents} className="shrink-0 text-base text-fg" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {statusBadge(a, today)}
                {a.status !== "paid" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-mr-2"
                    loading={mark.isPending && mark.variables?.id === a.id}
                    onClick={async () => {
                      try {
                        await mark.mutateAsync({ id: a.id, markPaid: true });
                        haptic("success");
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    Marquer payée
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {data.unpaidTotalCents > 0 ? (
            <li className="flex min-h-11 items-center justify-between px-4 py-2 text-sm text-fg-muted">
              <span>Reste à payer</span>
              <Money cents={data.unpaidTotalCents} className="font-medium text-fg" />
            </li>
          ) : null}
        </ListGroup>
      )}
    </Section>
  );
}

function AssessmentForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState({ text: "", cents: null as number | null });
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation("condo.upsertSpecialAssessment");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Ajoute un titre.");
    if (!amount.cents) return setError("Entre le montant de ta part.");
    setError(null);
    try {
      await save.mutateAsync({ title: title.trim(), amount: { cents: amount.cents }, dueOn: dueOn || null });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Titre">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Réfection de la toiture" maxLength={160} />
      </Field>
      <Field label="Ta part" error={error}>
        <MoneyInput value={amount.text} onValueChange={(text, cents) => setAmount({ text, cents })} />
      </Field>
      <Field label="Échéance">
        <DateInput value={dueOn} onValueChange={setDueOn} />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Ajouter
        </Button>
      </SheetFooter>
    </form>
  );
}

function InsuranceCard({ p, onEdit }: { p: Property | null; onEdit: () => void }) {
  const { today } = useSession();
  const i = p?.insurance;
  const gap =
    i?.syndicateDeductibleCents && i.ownerDeductibleCoverageCents !== null && i.ownerDeductibleCoverageCents < i.syndicateDeductibleCents
      ? i.syndicateDeductibleCents - i.ownerDeductibleCoverageCents
      : null;
  return (
    <Section title="Assurance habitation" id="ins" action={<EditButton onClick={onEdit} />}>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <DetailList
          className="sm:grid-cols-2"
          items={[
            { label: "Assureur", value: i?.insurer ?? <Unknown /> },
            { label: "Police", value: i?.policyNumber ?? <Unknown /> },
            {
              label: "Renouvellement",
              value: i?.renewalOn ? fmtDate(i.renewalOn) : <Unknown />,
              hint: i?.renewalOn ? relativeFr(i.renewalOn, today) : undefined,
            },
            { label: "Prime annuelle", value: i?.premiumCents != null ? <Money cents={i.premiumCents} /> : <Unknown /> },
            { label: "Franchise du syndicat", value: i?.syndicateDeductibleCents != null ? <Money cents={i.syndicateDeductibleCents} /> : <Unknown /> },
            {
              label: "Ta couverture de la franchise",
              value: i?.ownerDeductibleCoverageCents != null ? <Money cents={i.ownerDeductibleCoverageCents} /> : <Unknown />,
            },
          ]}
        />
        {gap ? (
          <p className="text-sm text-warning">
            Ta couverture ne paie pas toute la franchise du syndicat : il manque <Money cents={gap} />. Parles-en à ton assureur.
          </p>
        ) : null}
      </Card>
    </Section>
  );
}

function WelcomeTax({ p, onEdit }: { p: Property | null; onEdit: () => void }) {
  const { today } = useSession();
  const w = p?.welcomeTax;
  const mark = useOpMutation("condo.upsertProperty");
  if (!w || w.status === "unknown") {
    return (
      <Section title="Taxe de bienvenue" id="wt">
        <Card className="flex flex-col items-start gap-3 p-4 sm:p-5">
          <p className="text-base text-fg-muted">
            Entre le montant de ta taxe de bienvenue et son échéance : on te la rappellera avant la date limite.
          </p>
          <Button size="sm" onClick={onEdit}>
            Entrer la taxe de bienvenue
          </Button>
        </Card>
      </Section>
    );
  }
  return (
    <Section title="Taxe de bienvenue" id="wt" action={<EditButton onClick={onEdit} />}>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          {w.amountCents !== null ? <Money cents={w.amountCents} className="text-lg font-semibold text-fg" /> : <Unknown>Montant à préciser</Unknown>}
          {w.status === "paid" ? (
            <Badge>Payée le {fmtDate(w.paidOn)}</Badge>
          ) : w.status === "overdue" ? (
            <Badge tone="negative">En retard</Badge>
          ) : w.status === "due" ? (
            <Badge tone={w.daysUntilDue !== null && w.daysUntilDue <= 30 ? "warning" : "neutral"}>À payer {relativeFr(w.dueOn!, today)}</Badge>
          ) : (
            <Badge>Échéance à préciser</Badge>
          )}
        </div>
        {w.dueOn && w.status !== "paid" ? <p className="text-sm text-fg-muted">Échéance : {fmtDate(w.dueOn)}</p> : null}
        {w.status !== "paid" ? (
          <Button
            size="sm"
            className="self-start"
            loading={mark.isPending}
            onClick={async () => {
              try {
                await mark.mutateAsync({ welcomeTaxPaidOn: today });
                haptic("success");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Marquer payée aujourd&apos;hui
          </Button>
        ) : null}
      </Card>
    </Section>
  );
}

