"use client";

import { useState } from "react";
import { DateInput, Field, Input, MoneyInput, Skeleton } from "@/components/ui";
import type { OpInput, OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { StepActions, StepHeading } from "./onboarding-flow";
import { Button } from "@/components/ui";

type Property = NonNullable<OpOutput<"condo.getProperty">["property"]>;

type Draft = {
  addressLine: string;
  unit: string;
  city: string;
  yearBuilt: string;
  purchaseDate: string;
  condoFee: string;
  welcomeTax: string;
  welcomeTaxDueOn: string;
};

function fromProperty(p: Property | null): Draft {
  return {
    addressLine: p?.addressLine ?? "",
    unit: p?.unit ?? "",
    city: p?.city ?? "",
    yearBuilt: p?.yearBuilt ? String(p.yearBuilt) : "",
    purchaseDate: p?.purchaseDate ?? "",
    condoFee: centsToInput(p?.syndicate.condoFeeCents),
    welcomeTax: centsToInput(p?.welcomeTax.amountCents),
    welcomeTaxDueOn: p?.welcomeTax.dueOn ?? "",
  };
}

/** Only the fields the person touched (empty → null when it had a value). */
function toInput(d: Draft, base: Draft): OpInput<"condo.upsertProperty"> {
  const out: OpInput<"condo.upsertProperty"> = {};
  const text = (k: "addressLine" | "unit" | "city") => {
    if (d[k].trim() !== base[k].trim()) out[k] = d[k].trim() || null;
  };
  text("addressLine");
  text("unit");
  text("city");
  if (d.yearBuilt !== base.yearBuilt) out.yearBuilt = d.yearBuilt ? Number(d.yearBuilt) : null;
  if (d.purchaseDate !== base.purchaseDate) out.purchaseDate = d.purchaseDate || null;
  if (d.welcomeTaxDueOn !== base.welcomeTaxDueOn) out.welcomeTaxDueOn = d.welcomeTaxDueOn || null;
  if (d.condoFee !== base.condoFee) out.condoFee = d.condoFee ? d.condoFee : null;
  if (d.welcomeTax !== base.welcomeTax) out.welcomeTax = d.welcomeTax ? d.welcomeTax : null;
  return out;
}

export function CondoStep({ onNext, onBack }: { onNext: () => Promise<void>; onBack?: () => void }) {
  const property = useOp("condo.getProperty", {});
  return (
    <div className="flex flex-col">
      <StepHeading
        title="Le condo"
        description="Optionnel. Quelques infos de base pour suivre les frais de condo et ne pas oublier la taxe de bienvenue. Tout se complète plus tard dans Condo."
      />
      {property.isPending ? (
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton shape="card" className="h-[248px] w-full" />
          <Skeleton shape="card" className="h-[200px] w-full" />
        </div>
      ) : property.error ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-base text-fg-muted">{property.error.message}</p>
          <Button variant="secondary" onClick={() => property.refetch()}>
            Réessayer
          </Button>
        </div>
      ) : (
        <CondoForm key={property.data.property?.id ?? "new"} property={property.data.property} onNext={onNext} onBack={onBack} />
      )}
    </div>
  );
}

function CondoForm({ property, onNext, onBack }: { property: Property | null; onNext: () => Promise<void>; onBack?: () => void }) {
  const [base] = useState(() => fromProperty(property));
  const [d, setD] = useState(base);
  const [yearError, setYearError] = useState<string | null>(null);
  const save = useOpMutation("condo.upsertProperty", { invalidate: ["condo.getProperty"] });
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 md:p-5">
        <Field label="Adresse">
          <Input value={d.addressLine} onChange={(e) => set("addressLine")(e.target.value)} autoComplete="street-address" placeholder="1234, rue Rachel Est" maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unité">
            <Input value={d.unit} onChange={(e) => set("unit")(e.target.value)} placeholder="302" maxLength={20} />
          </Field>
          <Field label="Ville">
            <Input value={d.city} onChange={(e) => set("city")(e.target.value)} autoComplete="address-level2" placeholder="Montréal" maxLength={80} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Année de construction" error={yearError ?? undefined}>
            <Input
              value={d.yearBuilt}
              onChange={(e) => set("yearBuilt")(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="2012"
              className="num"
            />
          </Field>
          <Field label="Date d'achat">
            <DateInput value={d.purchaseDate} onValueChange={set("purchaseDate")} />
          </Field>
        </div>
        <Field label="Frais de condo" hint="Par mois, payés au syndicat.">
          <MoneyInput value={d.condoFee} onValueChange={(t) => set("condoFee")(t)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-card bg-surface p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-semibold">Taxe de bienvenue</h2>
          <p className="text-base text-fg-muted">
            Les droits de mutation. La facture de la ville arrive habituellement quelques mois après l&apos;achat : on te la rappellera.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Montant" hint="Souvent estimé par le notaire.">
            <MoneyInput value={d.welcomeTax} onValueChange={(t) => set("welcomeTax")(t)} />
          </Field>
          <Field label="Date prévue">
            <DateInput value={d.welcomeTaxDueOn} onValueChange={set("welcomeTaxDueOn")} />
          </Field>
        </div>
      </div>

      {save.error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {save.error.message}
        </p>
      ) : null}
      <StepActions
        onBack={onBack}
        onSkip={onNext}
        primary={
          <SaveButton
            onClick={async () => {
              if (d.yearBuilt && (Number(d.yearBuilt) < 1800 || Number(d.yearBuilt) > 2100)) {
                setYearError("Année invalide.");
                throw new Error("invalid");
              }
              setYearError(null);
              const input = toInput(d, base);
              if (Object.keys(input).length) await save.mutateAsync(input);
              await onNext();
            }}
          />
        }
      />
    </>
  );
}

function SaveButton({ onClick }: { onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="lg"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch {
          // Shown inline.
        } finally {
          setBusy(false);
        }
      }}
    >
      Continuer
    </Button>
  );
}
