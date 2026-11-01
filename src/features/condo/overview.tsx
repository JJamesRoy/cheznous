"use client";

import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  Coins,
  FileText,
  Landmark,
  Receipt,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Button, DateInput, EmptyState, Field, Input, Money, MoneyInput, Select, Sheet, SheetFooter, Skeleton } from "@/components/ui";
import { formatMonthFr, monthOf } from "@/domain/dates";
import { useSession } from "@/features/app/session";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { Card, decimalToFr, DetailList, fmtDate, parseDecimalFr, QueryError, relativeFr, Section, textOrNull, Unknown } from "./ui";

type KeyDate = OpOutput<"condo.keyDates">["items"][number];
export type Property = NonNullable<OpOutput<"condo.getProperty">["property"]>;

const KIND_ICON: Record<KeyDate["kind"], LucideIcon> = {
  mortgage_renewal: Landmark,
  prepayment_anniversary: CalendarClock,
  insurance_renewal: ShieldCheck,
  agm: Users,
  welcome_tax: Receipt,
  special_assessment: Coins,
  warranty_end: Wrench,
  bill: FileText,
  maintenance: Wrench,
};

function hrefFor(k: KeyDate): string | null {
  switch (k.source) {
    case "mortgage":
      return "/condo/hypotheque";
    case "property":
    case "special_assessment":
      return "/condo/syndicat";
    case "appliance":
    case "task":
      return "/condo/entretien";
    default:
      return null;
  }
}

export function CondoOverview() {
  const property = useOp("condo.getProperty", {});
  const [editing, setEditing] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <KeyDates />
      <Section
        title="L'unité"
        id="condo-unit"
        action={
          property.data?.property ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Modifier
            </Button>
          ) : null
        }
      >
        {property.isPending ? (
          <Skeleton shape="card" className="h-[300px]" />
        ) : property.error ? (
          <QueryError error={property.error} onRetry={() => property.refetch()} what="la fiche du condo" />
        ) : property.data.property ? (
          <PropertyCard p={property.data.property} />
        ) : (
          <EmptyState
            message="Ajoute l'adresse, l'année et la date d'achat de ton condo."
            action={
              <Button variant="primary" onClick={() => setEditing(true)}>
                Ajouter mon condo
              </Button>
            }
          />
        )}
      </Section>
      <PropertySheet open={editing} onOpenChange={setEditing} property={property.data?.property ?? null} />
    </div>
  );
}

function PropertyCard({ p }: { p: Property }) {
  const address = [p.addressLine, p.unit ? `unité ${p.unit}` : null].filter(Boolean).join(", ");
  const city = [p.city, p.postalCode].filter(Boolean).join(" ");
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col">
        <p className="text-md font-semibold text-fg">{address || <Unknown>Adresse non précisée</Unknown>}</p>
        {city ? <p className="text-base text-fg-muted">{city}</p> : null}
      </div>
      <DetailList
        className="sm:grid-cols-1 lg:grid-cols-1"
        items={[
          { label: "Type", value: p.ownershipTypeLabel },
          { label: "Année de construction", value: p.yearBuilt ?? <Unknown /> },
          {
            label: "Superficie",
            value: p.areaSqft ? `${p.areaSqft.toLocaleString("fr-CA")} pi²` : <Unknown />,
          },
          { label: "Date d'achat", value: p.purchaseDate ? fmtDate(p.purchaseDate) : <Unknown /> },
          { label: "Prix d'achat", value: p.purchasePriceCents ? <Money cents={p.purchasePriceCents} /> : <Unknown /> },
        ]}
      />
    </Card>
  );
}

function KeyDates() {
  const { today } = useSession();
  const q = useOp("condo.keyDates", { days: 365 });
  const [all, setAll] = useState(false);
  const LIMIT = 8;

  return (
    <Section
      title="Dates clés"
      id="condo-dates"
      description="Les 12 prochains mois : renouvellements, taxes, assemblée, garanties."
    >
      {q.isPending ? (
        <Skeleton shape="card" className="h-[420px]" />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="les dates clés" />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          message="Aucune échéance dans les 12 prochains mois. Ajoute ton hypothèque pour suivre son renouvellement."
          action={
            <Button asChild variant="primary">
              <Link href="/condo/hypotheque">Ajouter mon hypothèque</Link>
            </Button>
          }
        />
      ) : (
        <Card className="flex flex-col py-1">
          {groupByMonth(all ? q.data.items : q.data.items.slice(0, LIMIT)).map(([month, items]) => (
            <div key={month} className="flex flex-col">
              <h3 className="px-4 pt-3 pb-1 text-sm font-medium text-fg-subtle first-letter:uppercase sm:px-5">
                {formatMonthFr(month)}
              </h3>
              <ol className="flex flex-col">
                {items.map((k) => (
                  <li key={k.id}>
                    <KeyDateRow item={k} today={today} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {q.data.items.length > LIMIT ? (
            <button
              type="button"
              onClick={() => setAll((a) => !a)}
              className="mx-2 my-1 flex h-11 items-center justify-center rounded-control text-base text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {all ? "Afficher moins" : `Afficher les ${q.data.items.length} échéances`}
            </button>
          ) : null}
        </Card>
      )}
    </Section>
  );
}

function groupByMonth(items: KeyDate[]): [string, KeyDate[]][] {
  const map = new Map<string, KeyDate[]>();
  for (const it of items) {
    const m = monthOf(it.date);
    map.set(m, [...(map.get(m) ?? []), it]);
  }
  return [...map.entries()];
}

function KeyDateRow({ item: k, today }: { item: KeyDate; today: string }) {
  const Icon = KIND_ICON[k.kind];
  const soon = k.daysUntil <= 14;
  const href = hrefFor(k);
  const day = Number(k.date.slice(8, 10));
  const content = (
    <>
      <span className="flex w-9 shrink-0 flex-col items-center pt-0.5">
        <span className="num text-lg leading-6 font-semibold text-fg">{day}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base text-fg">{k.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          <Icon aria-hidden className="size-3.5 text-fg-subtle" />
          <span className={cn(soon ? "font-medium text-warning" : "text-fg-subtle")}>{relativeFr(k.date, today)}</span>
          {k.amountCents !== null ? (
            <>
              <span aria-hidden className="text-fg-subtle">·</span>
              <Money cents={k.amountCents} className="text-fg-muted" />
            </>
          ) : null}
        </span>
      </span>
      {href ? <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-gray-8" /> : null}
    </>
  );
  const cls = "flex w-full items-start gap-3 px-4 py-2.5 text-left sm:px-5";
  return href ? (
    <Link href={href} className={cn(cls, "pressable hover:bg-surface-2 focus-visible:-outline-offset-2")}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

// ---------------------------------------------------------------------------
// Property sheet
// ---------------------------------------------------------------------------

export function PropertySheet({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property: Property | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={property ? "Modifier l'unité" : "Ajouter mon condo"} desktop="panel">
      {open ? <PropertyForm property={property} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function PropertyForm({ property: p, onDone }: { property: Property | null; onDone: () => void }) {
  const [f, setF] = useState({
    addressLine: p?.addressLine ?? "",
    unit: p?.unit ?? "",
    city: p?.city ?? "Montréal",
    postalCode: p?.postalCode ?? "",
    yearBuilt: p?.yearBuilt ? String(p.yearBuilt) : "",
    area: decimalToFr(p?.areaSqft),
    ownershipType: p?.ownershipType ?? "divided",
    purchaseDate: p?.purchaseDate ?? "",
    price: centsToInput(p?.purchasePriceCents),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useOpMutation("condo.upsertProperty");
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const year = f.yearBuilt.trim() ? Number(f.yearBuilt) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1800 || year > 2100)) errs.yearBuilt = "Année invalide.";
    const area = f.area.trim() ? parseDecimalFr(f.area) : null;
    if (f.area.trim() && (area === null || area <= 0)) errs.area = "Superficie invalide.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync({
        addressLine: textOrNull(f.addressLine),
        unit: textOrNull(f.unit),
        city: textOrNull(f.city),
        postalCode: textOrNull(f.postalCode),
        yearBuilt: year,
        areaSqft: area,
        ownershipType: f.ownershipType as Property["ownershipType"],
        purchaseDate: f.purchaseDate || null,
        purchasePrice: f.price.trim() ? f.price : null,
      });
      haptic("success");
      onDone();
    } catch (err) {
      setErrors({ form: (err as Error).message });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Adresse">
        <Input value={f.addressLine} onChange={(e) => set("addressLine")(e.target.value)} autoComplete="street-address" placeholder="1234, rue Saint-Denis" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unité">
          <Input value={f.unit} onChange={(e) => set("unit")(e.target.value)} placeholder="402" />
        </Field>
        <Field label="Code postal">
          <Input value={f.postalCode} onChange={(e) => set("postalCode")(e.target.value)} autoComplete="postal-code" placeholder="H2J 3K5" />
        </Field>
      </div>
      <Field label="Ville">
        <Input value={f.city} onChange={(e) => set("city")(e.target.value)} autoComplete="address-level2" />
      </Field>
      <Field label="Type de propriété">
        <Select
          value={f.ownershipType}
          onValueChange={set("ownershipType")}
          options={[
            { value: "divided", label: "Copropriété divise" },
            { value: "undivided", label: "Copropriété indivise" },
            { value: "freehold", label: "Pleine propriété" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Année de construction" error={errors.yearBuilt}>
          <Input value={f.yearBuilt} onChange={(e) => set("yearBuilt")(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="2008" />
        </Field>
        <Field label="Superficie (pi²)" error={errors.area}>
          <Input value={f.area} onChange={(e) => set("area")(e.target.value)} inputMode="decimal" placeholder="850" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date d'achat">
          <DateInput value={f.purchaseDate} onValueChange={set("purchaseDate")} />
        </Field>
        <Field label="Prix d'achat">
          <MoneyInput value={f.price} onValueChange={(t) => set("price")(t)} />
        </Field>
      </div>
      {errors.form ? (
        <p role="alert" className="text-sm text-negative">
          {errors.form}
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
