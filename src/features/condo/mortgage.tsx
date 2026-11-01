"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ChipGroup,
  DateInput,
  EmptyState,
  Field,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  ProgressBar,
  SegmentedControl,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  Textarea,
  toast,
} from "@/components/ui";
import { useMembers, useSession } from "@/features/app/session";
import type { OpOutput } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { centsToInput, formatMoney } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { Card, decimalToFr, DetailList, fmtDate, fmtDateShort, Note, parseDecimalFr, QueryError, Section, textOrNull, Unknown } from "./ui";

type Summary = OpOutput<"condo.getMortgageSummary">;
type Mortgage = NonNullable<Summary["mortgage"]>;

const FREQUENCIES = [
  { value: "monthly", label: "Mensuel" },
  { value: "semimonthly", label: "Bimensuel (2 fois par mois)" },
  { value: "biweekly", label: "Aux deux semaines" },
  { value: "accelerated_biweekly", label: "Aux deux semaines accéléré" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "accelerated_weekly", label: "Hebdomadaire accéléré" },
] as const;

const nf = new Intl.NumberFormat("fr-CA");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n > 1 ? many : one}`;
const years = (months: number | null) =>
  months === null ? null : months % 12 === 0 ? plural(months / 12, "an", "ans") : plural(months, "mois", "mois");

export function MortgageSection() {
  const q = useOp("condo.getMortgageSummary", {});
  const [sheet, setSheet] = useState<null | "edit" | "prepay" | "statement">(null);
  const close = (o: boolean) => !o && setSheet(null);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy aria-label="Chargement de l'hypothèque">
        <Skeleton shape="card" className="h-[260px]" />
        <Skeleton shape="card" className="h-[320px]" />
      </div>
    );
  }
  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} what="l'hypothèque" />;
  const s = q.data;

  return (
    <>
      {!s.mortgage ? (
        <EmptyState
          message="Ajoute les infos de ton hypothèque : taux, versement et renouvellement. On calcule le solde, les intérêts et ton privilège de remboursement anticipé."
          action={
            <Button variant="primary" onClick={() => setSheet("edit")}>
              Ajouter les infos de mon hypothèque
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            <BalanceCard s={s} onStatement={() => setSheet("statement")} onPrepay={() => setSheet("prepay")} />
            <Schedule s={s} />
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <Section
              title="Le prêt"
              id="mtg-loan"
              action={
                <Button size="sm" variant="ghost" onClick={() => setSheet("edit")}>
                  <Pencil aria-hidden />
                  Modifier
                </Button>
              }
            >
              <LoanCard m={s.mortgage} s={s} />
            </Section>
            <Privilege s={s} onEdit={() => setSheet("edit")} />
            <Prepayments s={s} onAdd={() => setSheet("prepay")} />
          </div>
        </div>
      )}

      <Sheet open={sheet === "edit"} onOpenChange={close} title={s.mortgage ? "Modifier l'hypothèque" : "Ton hypothèque"} desktop="panel">
        {sheet === "edit" ? <MortgageForm m={s.mortgage} onDone={() => setSheet(null)} /> : null}
      </Sheet>
      <Sheet
        open={sheet === "prepay"}
        onOpenChange={close}
        title="Remboursement anticipé"
        description="Un montant versé en plus de tes versements réguliers."
      >
        {sheet === "prepay" ? <PrepaymentForm s={s} onDone={() => setSheet(null)} /> : null}
      </Sheet>
      <Sheet
        open={sheet === "statement"}
        onOpenChange={close}
        title="Ajouter un relevé"
        description="Le solde inscrit sur ton relevé du prêteur. La projection repart de ce montant."
      >
        {sheet === "statement" ? <StatementForm onDone={() => setSheet(null)} /> : null}
      </Sheet>
    </>
  );
}

function BalanceCard({ s, onStatement, onPrepay }: { s: Summary; onStatement: () => void; onPrepay: () => void }) {
  const sch = s.schedule;
  const value = sch ? sch.estimatedBalanceCents : (s.balance?.balanceCents ?? null);
  const fromStatement = s.balance?.source === "statement";
  const estimate = !sch ? s.balance?.source !== "statement" : sch.balanceIsEstimate || !fromStatement;

  let evidence: React.ReactNode = null;
  if (s.balance) {
    if (fromStatement && !estimate) evidence = <>Selon le relevé du {fmtDate(s.balance.asOf)}</>;
    else if (fromStatement && sch)
      evidence = (
        <>
          Estimé à partir du relevé du {fmtDate(s.balance.asOf)}
          {sch.paymentsSinceReference ? ` et de ${plural(sch.paymentsSinceReference, "versement prévu", "versements prévus")} depuis` : ""}
          {sch.prepaymentsSinceReferenceCents ? (
            <>
              , moins <Money cents={sch.prepaymentsSinceReferenceCents} /> de remboursements anticipés
            </>
          ) : null}
        </>
      );
    else evidence = <>Estimé à partir du capital d&apos;origine — ajoute ton dernier relevé pour un solde exact</>;
  }

  return (
    <Card as="section" aria-labelledby="mtg-balance" className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="mtg-balance" className="text-sm text-fg-muted">
          {estimate ? "Solde estimé" : "Solde"}
        </h2>
        {value !== null ? (
          <Money cents={value} animate className="text-2xl font-semibold text-fg" />
        ) : (
          <p className="text-lg font-semibold text-fg-muted">Solde inconnu</p>
        )}
        {evidence ? <p className="text-base text-fg-muted">{evidence}</p> : null}
        {!sch && s.reason ? <p className="text-base text-fg-muted">{s.reason}</p> : null}
      </div>

      {sch || s.renewal ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3 sm:gap-y-4">
          {s.renewal ? (
            <Fact
              label="Renouvellement"
              value={
                s.renewal.daysUntil !== null && s.renewal.daysUntil >= 0
                  ? s.renewal.daysUntil === 0
                    ? "aujourd'hui"
                    : `dans ${plural(s.renewal.daysUntil, "jour", "jours")}`
                  : "échu"
              }
              hint={`${fmtDate(s.renewal.date)}${s.renewal.estimated ? " (estimé)" : ""}`}
              tone={s.renewal.daysUntil !== null && s.renewal.daysUntil <= 120 ? "warning" : undefined}
            />
          ) : null}
          {sch?.projectedPayoffDate ? (
            <Fact label="Fin prévue" value={fmtDate(sch.projectedPayoffDate)} hint={`encore ${plural(sch.remainingPayments, "versement", "versements")}`} />
          ) : null}
          {sch ? <Fact label="Intérêts restants" value={<Money cents={sch.totalInterestRemainingCents} />} hint="si rien ne change" /> : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onStatement}>
          <Plus aria-hidden />
          Ajouter un relevé
        </Button>
        <Button size="sm" onClick={onPrepay}>
          <Plus aria-hidden />
          Remboursement anticipé
        </Button>
      </div>
    </Card>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warning" }) {
  // Phone: label left, value right (one line each). From sm up: stacked columns.
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 sm:flex-col sm:justify-start sm:gap-0">
      <dt className="shrink-0 text-sm text-fg-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-col items-end sm:items-start">
        <span className={cn("text-md font-semibold whitespace-nowrap sm:text-lg", tone === "warning" ? "text-warning" : "text-fg")}>{value}</span>
        {hint ? <span className="text-sm text-fg-subtle">{hint}</span> : null}
      </dd>
    </div>
  );
}

function LoanCard({ m, s }: { m: Mortgage; s: Summary }) {
  return (
    <Card className="px-4 py-1 sm:px-5 sm:py-3">
      <DetailList
        className="sm:grid-cols-2 lg:grid-cols-1"
        items={[
          { label: "Prêteur", value: m.lender ?? <Unknown /> },
          {
            label: "Taux",
            value: m.rate ? `${m.rate} · ${m.rateTypeLabel.toLowerCase()}` : <Unknown />,
          },
          { label: "Terme", value: years(m.termMonths) ?? <Unknown /> },
          {
            label: "Versement",
            value: s.schedule ? <Money cents={s.schedule.paymentCents} /> : m.paymentCents ? <Money cents={m.paymentCents} /> : <Unknown />,
            hint: `${m.paymentFrequencyLabel}${s.schedule?.paymentSource === "computed" ? " · calculé selon l'amortissement" : ""}`,
          },
          { label: "Amortissement", value: years(m.amortizationMonths) ?? <Unknown /> },
          { label: "Capital d'origine", value: m.originalPrincipalCents ? <Money cents={m.originalPrincipalCents} /> : <Unknown /> },
          { label: "Début du prêt", value: m.startDate ? fmtDate(m.startDate) : <Unknown /> },
          {
            label: "Solde au renouvellement",
            value: s.schedule?.balanceAtRenewalCents != null ? <Money cents={s.schedule.balanceAtRenewalCents} /> : <Unknown>—</Unknown>,
            hint: s.schedule?.balanceAtRenewalCents != null ? "estimé" : undefined,
          },
        ]}
      />
    </Card>
  );
}

function Privilege({ s, onEdit }: { s: Summary; onEdit: () => void }) {
  const p = s.privilege;
  return (
    <Section title="Privilège de remboursement anticipé" id="mtg-priv">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        {p ? (
          <>
            <div className="flex flex-col">
              <span className="text-sm text-fg-subtle">Privilège restant cette année</span>
              <Money cents={p.remainingCents} animate className="text-lg font-semibold text-fg" />
            </div>
            <ProgressBar
              value={p.usedCents}
              max={p.allowedCents}
              tone="accent"
              label="Privilège utilisé cette année"
              valueText={`${formatMoney(p.usedCents)} utilisés sur ${formatMoney(p.allowedCents)}`}
            />
            <p className="text-sm text-fg-muted">
              <Money cents={p.usedCents} /> utilisés sur <Money cents={p.allowedCents} /> permis ({nf.format(p.privilegePct)} % du capital
              d&apos;origine), du {fmtDate(p.yearStart)} au {fmtDate(p.yearEnd)}.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-base text-fg-muted">{s.privilegeReason}</p>
            <Button size="sm" onClick={onEdit}>
              Compléter le prêt
            </Button>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Prepayments({ s, onAdd }: { s: Summary; onAdd: () => void }) {
  return (
    <Section
      title="Remboursements anticipés"
      id="mtg-prepay"
      action={
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus aria-hidden />
          Ajouter
        </Button>
      }
    >
      {s.prepayments.length === 0 ? (
        <p className="text-base text-fg-subtle">Aucun remboursement anticipé enregistré.</p>
      ) : (
        <ListGroup as="ul">
          {s.prepayments.map((p) => (
            <li key={p.id} className="flex min-h-[52px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base text-fg">{fmtDate(p.paidOn)}</span>
                <span className="truncate text-sm text-fg-subtle">
                  {[p.paidBy?.name, p.note].filter(Boolean).join(" · ") || "Payeur non précisé"}
                </span>
              </span>
              <Money cents={p.amountCents} className="text-base text-fg" />
            </li>
          ))}
          {"prepaymentsTotalCents" in s && s.prepayments.length > 1 ? (
            <li className="flex min-h-11 items-center justify-between px-4 py-2 text-sm text-fg-muted">
              <span>Total</span>
              <Money cents={s.prepaymentsTotalCents} />
            </li>
          ) : null}
        </ListGroup>
      )}
    </Section>
  );
}

function Schedule({ s }: { s: Summary }) {
  const sch = s.schedule;
  return (
    <Section title="12 prochains versements" id="mtg-sched">
      {!sch ? (
        <Note>{s.reason ?? "Ajoute le solde et le taux pour voir les prochains versements."}</Note>
      ) : sch.paidOff ? (
        <Note>Selon la projection, le prêt est remboursé.</Note>
      ) : (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm sm:text-base">
              <caption className="sr-only">12 prochains versements : intérêts, capital et solde après le versement</caption>
              <thead>
                <tr className="border-b border-border text-left text-sm text-fg-subtle">
                  <th scope="col" className="py-2.5 pr-2 pl-4 font-normal sm:pl-5">Date</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Intérêts</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Capital</th>
                  <th scope="col" className="py-2.5 pr-4 pl-2 text-right font-normal sm:pr-5">Solde</th>
                </tr>
              </thead>
              <tbody>
                {sch.next.map((r) => (
                  <tr key={r.n} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2 pr-2 pl-4 text-left font-normal whitespace-nowrap text-fg sm:pl-5">
                      {fmtDateShort(r.date)}
                    </th>
                    <td className="px-2 py-2 text-right text-fg-muted">
                      <Money cents={r.interestCents} round />
                    </td>
                    <td className="px-2 py-2 text-right text-fg">
                      <Money cents={r.principalCents} round />
                    </td>
                    <td className="py-2 pr-4 pl-2 text-right text-fg-muted sm:pr-5">
                      <Money cents={r.balanceCents} round />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-sm text-fg-subtle">
            {sch.note}{" "}
            {s.approximation
              ? "Les montants réels dépendent des variations du taux préférentiel."
              : "C'est la méthode utilisée par les prêteurs canadiens pour les prêts à taux fixe."}
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-negative">
      {message}
    </p>
  ) : null;
}

function MortgageForm({ m, onDone }: { m: Mortgage | null; onDone: () => void }) {
  const [f, setF] = useState({
    lender: m?.lender ?? "",
    principal: centsToInput(m?.originalPrincipalCents),
    rate: decimalToFr(m?.ratePct),
    rateType: m?.rateType ?? "fixed",
    termYears: m?.termMonths ? decimalToFr(Math.round((m.termMonths / 12) * 100) / 100) : "",
    startDate: m?.startDate ?? "",
    renewalDate: m && !m.renewalEstimated ? (m.renewalDate ?? "") : "",
    amortYears: m?.amortizationMonths ? decimalToFr(Math.round((m.amortizationMonths / 12) * 100) / 100) : "",
    payment: centsToInput(m?.paymentCents),
    frequency: m?.paymentFrequency ?? "monthly",
    privilege: decimalToFr(m?.prepaymentPrivilegePct),
    anniversary: m?.prepaymentAnniversary ?? "",
    notes: m?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useOpMutation("condo.upsertMortgage");
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const rate = f.rate.trim() ? parseDecimalFr(f.rate) : null;
    if (f.rate.trim() && (rate === null || rate >= 30)) errs.rate = "Entre un taux comme 4,79.";
    const term = f.termYears.trim() ? parseDecimalFr(f.termYears) : null;
    if (f.termYears.trim() && (term === null || term < 0.1 || term > 10)) errs.termYears = "Entre 0,5 et 10 ans.";
    const amort = f.amortYears.trim() ? parseDecimalFr(f.amortYears) : null;
    if (f.amortYears.trim() && (amort === null || amort < 1 || amort > 40)) errs.amortYears = "Entre 1 et 40 ans.";
    const priv = f.privilege.trim() ? parseDecimalFr(f.privilege) : null;
    if (f.privilege.trim() && (priv === null || priv > 100)) errs.privilege = "Entre un pourcentage comme 15.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync({
        id: m?.id,
        lender: textOrNull(f.lender),
        originalPrincipal: f.principal ? f.principal : null,
        rate,
        rateType: f.rateType as "fixed" | "variable",
        ...(term !== null ? { termYears: term } : { termMonths: null }),
        startDate: f.startDate || null,
        renewalDate: f.renewalDate || null,
        ...(amort !== null ? { amortizationYears: amort } : { amortizationMonths: null }),
        payment: f.payment ? f.payment : null,
        paymentFrequency: f.frequency as Mortgage["paymentFrequency"],
        prepaymentPrivilegePct: priv,
        prepaymentAnniversary: f.anniversary || null,
        notes: textOrNull(f.notes),
      });
      haptic("success");
      onDone();
    } catch (err) {
      setErrors({ form: (err as Error).message });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Prêteur">
        <Input value={f.lender} onChange={(e) => set("lender")(e.target.value)} placeholder="Desjardins" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Taux annuel" error={errors.rate}>
          <Input value={f.rate} onChange={(e) => set("rate")(e.target.value)} inputMode="decimal" placeholder="4,79" trailing={<span aria-hidden>%</span>} />
        </Field>
        <Field label="Type de taux">
          <SegmentedControl
            aria-label="Type de taux"
            value={f.rateType}
            onValueChange={set("rateType")}
            options={[
              { value: "fixed", label: "Fixe" },
              { value: "variable", label: "Variable" },
            ]}
          />
        </Field>
      </div>
      <Field label="Capital d'origine" hint="Le montant emprunté au départ.">
        <MoneyInput value={f.principal} onValueChange={(t) => set("principal")(t)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Terme (ans)" error={errors.termYears}>
          <Input value={f.termYears} onChange={(e) => set("termYears")(e.target.value)} inputMode="decimal" placeholder="5" />
        </Field>
        <Field label="Amortissement (ans)" error={errors.amortYears}>
          <Input value={f.amortYears} onChange={(e) => set("amortYears")(e.target.value)} inputMode="decimal" placeholder="25" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début du prêt">
          <DateInput value={f.startDate} onValueChange={set("startDate")} />
        </Field>
        <Field label="Renouvellement" hint={!f.renewalDate ? "Sinon : début + terme." : undefined}>
          <DateInput value={f.renewalDate} onValueChange={set("renewalDate")} />
        </Field>
      </div>
      <Field label="Versement" hint="Laisse vide pour le calculer selon le capital et l'amortissement.">
        <MoneyInput value={f.payment} onValueChange={(t) => set("payment")(t)} />
      </Field>
      <Field label="Fréquence des versements">
        <Select value={f.frequency} onValueChange={set("frequency")} options={FREQUENCIES.map((x) => ({ ...x }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Privilège annuel" error={errors.privilege} hint="% du capital d'origine">
          <Input value={f.privilege} onChange={(e) => set("privilege")(e.target.value)} inputMode="decimal" placeholder="15" trailing={<span aria-hidden>%</span>} />
        </Field>
        <Field label="Anniversaire du privilège" hint="Sinon : début du prêt.">
          <DateInput value={f.anniversary} onValueChange={set("anniversary")} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3} />
      </Field>
      <FormError message={errors.form ?? null} />
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Enregistrer
        </Button>
      </SheetFooter>
    </form>
  );
}

function PrepaymentForm({ s, onDone }: { s: Summary; onDone: () => void }) {
  const { today } = useSession();
  const { members } = useMembers();
  const [key] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState({ text: "", cents: null as number | null });
  const [paidOn, setPaidOn] = useState(today);
  const [paidBy, setPaidBy] = useState<string>("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useOpMutation("condo.addPrepayment");
  const remaining = s.privilege?.remainingCents ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount.cents) return setError("Entre un montant.");
    if (paidOn > today) return setError("La date ne peut pas être dans le futur.");
    setError(null);
    try {
      const r = await add.mutateAsync({
        amount: { cents: amount.cents },
        paidOn,
        paidBy: paidBy === "none" ? undefined : paidBy,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      haptic("success");
      if (r.warning) toast.warning(r.warning, { duration: 10_000 });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Montant"
        hint={remaining !== null ? <>Privilège restant cette année : <Money cents={remaining} /></> : undefined}
        error={error}
      >
        <MoneyInput value={amount.text} onValueChange={(text, cents) => setAmount({ text, cents })} autoFocus />
      </Field>
      {remaining !== null && amount.cents && amount.cents > remaining ? (
        <p className="text-sm text-warning">
          Ce montant dépasse ton privilège restant : vérifie avec ton prêteur, des pénalités pourraient s&apos;appliquer.
        </p>
      ) : null}
      <Field label="Date du versement">
        <DateInput value={paidOn} onValueChange={setPaidOn} max={today} />
      </Field>
      <Field label="Payé par">
        <ChipGroup
          aria-label="Payé par"
          value={paidBy}
          onValueChange={setPaidBy}
          options={[...members.map((m) => ({ value: m.userId, label: m.isMe ? "Moi" : m.displayName })), { value: "none", label: "Non précisé" }]}
        />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Boni annuel" maxLength={500} />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Ajouter
        </Button>
      </SheetFooter>
    </form>
  );
}

function StatementForm({ onDone }: { onDone: () => void }) {
  const { today } = useSession();
  const [balance, setBalance] = useState({ text: "", cents: null as number | null });
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const add = useOpMutation("condo.addStatement");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (balance.cents === null) return setError("Entre le solde du relevé.");
    if (asOf > today) return setError("La date ne peut pas être dans le futur.");
    setError(null);
    try {
      await add.mutateAsync({ balance: { cents: balance.cents }, asOf });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Solde du relevé" error={error}>
        <MoneyInput value={balance.text} onValueChange={(text, cents) => setBalance({ text, cents })} autoFocus />
      </Field>
      <Field label="Date du relevé">
        <DateInput value={asOf} onValueChange={setAsOf} max={today} />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Enregistrer le relevé
        </Button>
      </SheetFooter>
    </form>
  );
}
