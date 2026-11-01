import { z } from "zod";
import { defineOp } from "../op";
import { unwrap } from "../errors";
import type { HouseholdCtx } from "../ctx";
import { selectAll, today } from "../support";
import { formatMoney } from "../../domain/money";
import { addDays, diffDays, parseDate, type CivilDate } from "../../domain/dates";
import { occurrencesBetween, type Frequency } from "../../domain/recurrence";
import { isDomainError } from "../../domain/errors";
import { effectiveRenewal, loadAppliances, loadAssessments, loadMortgage, loadPrepayments, loadProperty, mortgagePrivilege } from "./condo";

export type KeyDateKind =
  | "mortgage_renewal"
  | "prepayment_anniversary"
  | "insurance_renewal"
  | "agm"
  | "welcome_tax"
  | "special_assessment"
  | "warranty_end"
  | "bill"
  | "maintenance";

export type KeyDateSource = "mortgage" | "property" | "special_assessment" | "appliance" | "recurring_rule" | "task";

export type KeyDate = {
  id: string;
  kind: KeyDateKind;
  title: string;
  date: CivilDate;
  daysUntil: number;
  amountCents: number | null;
  amount: string | null;
  source: KeyDateSource;
  /** Id of the row the date comes from (mortgage, property, task…). */
  refId: string;
};

type BillRule = {
  id: string;
  title: string;
  amount_cents: number | null;
  frequency: Frequency;
  anchor_date: string;
  installment_dates: string[] | null;
  end_date: string | null;
};

const within = (d: string | null | undefined, from: CivilDate, to: CivilDate): d is string => !!d && d >= from && d <= to;

/**
 * Every dated obligation of the household in [from, to] (inclusive), sorted by date.
 * `daysUntil` is relative to today in the household's timezone. Reused by the dashboard.
 */
export async function keyDatesBetween(ctx: HouseholdCtx, from: CivilDate, to: CivilDate): Promise<KeyDate[]> {
  parseDate(from);
  parseDate(to);
  const t = today(ctx);
  const hid = ctx.household.id;
  const items: KeyDate[] = [];
  const push = (it: Omit<KeyDate, "daysUntil" | "amount" | "id"> & { id?: string }) =>
    items.push({
      ...it,
      id: it.id ?? `${it.kind}:${it.refId}:${it.date}`,
      daysUntil: diffDays(t, it.date),
      amount: it.amountCents === null ? null : formatMoney(it.amountCents),
    });

  const [property, mortgage, assessments, appliances, rules, tasks] = await Promise.all([
    loadProperty(ctx),
    loadMortgage(ctx),
    loadAssessments(ctx),
    loadAppliances(ctx),
    selectAll<BillRule>((a, b) =>
      ctx.db
        .from("recurring_rules")
        .select("id, title, amount_cents, frequency, anchor_date, installment_dates, end_date")
        .eq("household_id", hid)
        .eq("kind", "bill")
        .eq("active", true)
        .lte("anchor_date", to)
        .order("id")
        .range(a, b),
    ),
    ctx.db
      .from("tasks")
      .select("id, title, due_on")
      .eq("household_id", hid)
      .eq("kind", "maintenance")
      .is("completed_at", null)
      .gte("due_on", from)
      .lte("due_on", to)
      .order("due_on")
      .limit(500),
  ]);

  // Mortgage: renewal + prepayment anniversary (privilege resets).
  if (mortgage) {
    const lender = mortgage.lender ? ` (${mortgage.lender})` : "";
    const renewal = effectiveRenewal(mortgage);
    if (within(renewal.date, from, to)) {
      push({
        kind: "mortgage_renewal",
        title: `Renouvellement de l'hypothèque${lender}${renewal.estimated ? " — date estimée" : ""}`,
        date: renewal.date,
        amountCents: null,
        source: "mortgage",
        refId: mortgage.id,
      });
    }
    const anchor = mortgage.prepayment_anniversary ?? mortgage.start_date;
    if (anchor && (mortgage.prepayment_anniversary || mortgage.prepayment_privilege_bp !== null)) {
      const dates = occurrencesBetween({ frequency: "yearly", anchorDate: anchor }, from, to).filter(
        (d) => mortgage.prepayment_anniversary || d !== mortgage.start_date,
      );
      if (dates.length) {
        const { privilege } = mortgagePrivilege(ctx, mortgage, await loadPrepayments(ctx, mortgage.id));
        for (const d of dates) {
          const current = privilege && d === privilege.yearEndExclusive;
          push({
            kind: "prepayment_anniversary",
            title: current
              ? `Anniversaire du prêt : ton privilège de remboursement anticipé se renouvelle (il te reste ${privilege.remaining} à utiliser d'ici là)`
              : "Anniversaire du prêt : ton privilège de remboursement anticipé se renouvelle",
            date: d,
            amountCents: current ? privilege.remainingCents : null,
            source: "mortgage",
            refId: mortgage.id,
          });
        }
      }
    }
  }

  // Property: insurance renewal (yearly from the stored date), AGM, welcome tax.
  if (property) {
    if (property.insurance_renewal_on) {
      for (const d of occurrencesBetween({ frequency: "yearly", anchorDate: property.insurance_renewal_on }, from, to)) {
        const insurer = property.insurer ? ` (${property.insurer})` : "";
        push({
          kind: "insurance_renewal",
          title: `Renouvellement de l'assurance habitation${insurer}${d !== property.insurance_renewal_on ? " — prévu" : ""}`,
          date: d,
          amountCents: property.insurance_premium_cents === null ? null : Number(property.insurance_premium_cents),
          source: "property",
          refId: property.id,
        });
      }
    }
    if (within(property.agm_date, from, to)) {
      push({ kind: "agm", title: "Assemblée générale du syndicat", date: property.agm_date, amountCents: null, source: "property", refId: property.id });
    }
    if (!property.welcome_tax_paid_on && within(property.welcome_tax_due_on, from, to)) {
      push({
        kind: "welcome_tax",
        title: "Taxe de bienvenue à payer",
        date: property.welcome_tax_due_on,
        amountCents: property.welcome_tax_cents === null ? null : Number(property.welcome_tax_cents),
        source: "property",
        refId: property.id,
      });
    }
  }

  for (const a of assessments) {
    if (a.paid_on || !within(a.due_on, from, to)) continue;
    push({
      kind: "special_assessment",
      title: `Cotisation spéciale : ${a.title}`,
      date: a.due_on,
      amountCents: Number(a.amount_cents),
      source: "special_assessment",
      refId: a.id,
    });
  }

  for (const ap of appliances) {
    if (!within(ap.warranty_ends_on, from, to)) continue;
    push({ kind: "warranty_end", title: `Fin de la garantie : ${ap.name}`, date: ap.warranty_ends_on, amountCents: null, source: "appliance", refId: ap.id });
  }

  for (const r of rules) {
    let dates: CivilDate[];
    try {
      dates = occurrencesBetween(
        { frequency: r.frequency, anchorDate: r.anchor_date, installmentDates: r.installment_dates ?? [], endDate: r.end_date },
        from,
        to,
      );
    } catch (e) {
      if (isDomainError(e)) continue; // malformed rule: skip rather than break the whole view
      throw e;
    }
    for (const d of dates) {
      push({ kind: "bill", title: r.title, date: d, amountCents: r.amount_cents === null ? null : Number(r.amount_cents), source: "recurring_rule", refId: r.id });
    }
  }

  for (const task of unwrap(tasks) as { id: string; title: string; due_on: string }[]) {
    push({ kind: "maintenance", title: `Entretien : ${task.title}`, date: task.due_on, amountCents: null, source: "task", refId: task.id });
  }

  return items
    .filter((i) => i.date >= from && i.date <= to)
    .sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? a.title.localeCompare(b.title, "fr-CA") : a.kind < b.kind ? -1 : 1) : a.date < b.date ? -1 : 1));
}

export const keyDates = defineOp({
  name: "condo.keyDates",
  kind: "read",
  input: z.object({ days: z.number().int().min(1).max(730).default(120) }),
  run: async (ctx, input) => {
    const from = today(ctx);
    const to = addDays(from, input.days);
    const items = await keyDatesBetween(ctx, from, to);
    return { from, to, items, count: items.length };
  },
});
