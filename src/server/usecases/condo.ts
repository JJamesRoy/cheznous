import { z } from "zod";
import { defineOp } from "../op";
import { AppError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import { idempotent, moneyToCents, resolveMember, selectAll, today, zDate, zIdempotencyKey, zMoney } from "../support";
import { centsToDecimal, formatMoney } from "../../domain/money";
import { addDays, addMonthsClamped, diffDays, isValidDate, type CivilDate } from "../../domain/dates";
import { normalizeKey } from "../../domain/text";
import { isDomainError } from "../../domain/errors";
import {
  PAYMENT_FREQUENCY_LABELS_FR,
  amortizationSchedule,
  computePayment,
  paymentDate,
  prepaymentPrivilege,
  summarizeMortgage,
  type Compounding,
  type PaymentFrequency,
  type ScheduleRow,
} from "../../domain/amortization";

// ---------------------------------------------------------------------------
// Shared fragments & helpers
// ---------------------------------------------------------------------------

/** A real civil date (zDate only checks the shape). */
export const zDay = zDate.refine(isValidDate, "Date invalide.");
/** Decimal number given as a number or a fr-CA string ("4,79", "4,79 %"). */
export const zDecimal = z.union([z.number(), z.string().trim().min(1).max(20)]);

const zText = (max: number) => z.string().trim().max(max);
const zOptText = (max: number) => zText(max).nullable().optional();

export function parseDecimal(v: number | string, label: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new AppError("VALIDATION", `${label} invalide.`);
    return v;
  }
  const s = v.replace(/[\s  %]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AppError("VALIDATION", `${label} invalide : « ${v} ».`);
  return Number(s);
}

export const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export const fmt = (v: number | string | null | undefined): string | null => (v === null || v === undefined ? null : formatMoney(Number(v)));

/** Set `out[col]` only for fields the caller provided (undefined = keep, null = clear). */
function put<T>(out: Record<string, unknown>, col: string, v: T | null | undefined, map?: (v: T) => unknown) {
  if (v === undefined) return;
  out[col] = v === null ? null : map ? map(v) : v;
}

const pctFormatter = new Intl.NumberFormat("fr-CA", { style: "percent", maximumFractionDigits: 3 });
export const formatPct = (pct: number) => pctFormatter.format(pct / 100);

function daysUntil(ctx: HouseholdCtx, d: CivilDate | null): number | null {
  return d ? diffDays(today(ctx), d) : null;
}

function cleanUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new AppError("VALIDATION", "Ce lien n'est pas une adresse web valide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("VALIDATION", "Le lien doit commencer par http:// ou https://.");
  }
  return url.toString();
}

async function assertAppliance(ctx: HouseholdCtx, id: string) {
  const row = unwrap(
    await ctx.db.from("appliances").select("id, name").eq("household_id", ctx.household.id).eq("id", id).maybeSingle(),
  ) as { id: string; name: string } | null;
  if (!row) throw new AppError("NOT_FOUND", "Appareil introuvable.");
  return row;
}

// ---------------------------------------------------------------------------
// Labels (fr-CA)
// ---------------------------------------------------------------------------

export const OWNERSHIP_TYPES = ["divided", "undivided", "freehold"] as const;
export const OWNERSHIP_TYPE_LABELS_FR: Record<(typeof OWNERSHIP_TYPES)[number], string> = {
  divided: "Copropriété divise",
  undivided: "Copropriété indivise",
  freehold: "Pleine propriété",
};

export const DOC_TYPES = [
  "declaration",
  "reglements",
  "pv_assemblee",
  "budget_syndicat",
  "attestation",
  "carnet_entretien",
  "etude_fonds_prevoyance",
  "acte_vente",
  "hypotheque",
  "assurance",
  "taxes",
  "inspection",
  "garantie",
  "facture",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABELS_FR: Record<DocType, string> = {
  declaration: "Déclaration de copropriété",
  reglements: "Règlements de l'immeuble",
  pv_assemblee: "Procès-verbal d'assemblée",
  budget_syndicat: "Budget du syndicat",
  attestation: "Attestation du syndicat",
  carnet_entretien: "Carnet d'entretien",
  etude_fonds_prevoyance: "Étude du fonds de prévoyance",
  acte_vente: "Acte de vente",
  hypotheque: "Hypothèque",
  assurance: "Assurance",
  taxes: "Taxes",
  inspection: "Inspection",
  garantie: "Garantie",
  facture: "Facture",
  other: "Autre",
};

export const CAPITAL_KINDS = ["down_payment", "notary", "inspection", "welcome_tax", "renovation", "prepayment", "other"] as const;
export type CapitalKind = (typeof CAPITAL_KINDS)[number];
export const CAPITAL_KIND_LABELS_FR: Record<CapitalKind, string> = {
  down_payment: "Mise de fonds",
  notary: "Notaire",
  inspection: "Inspection",
  welcome_tax: "Taxe de bienvenue",
  renovation: "Rénovations",
  prepayment: "Remboursement anticipé",
  other: "Autre",
};

export const CAPITAL_SOURCES = ["celiapp", "rap_reer", "cash", "gift", "line_of_credit", "other"] as const;
export type CapitalSource = (typeof CAPITAL_SOURCES)[number];
export const CAPITAL_SOURCE_LABELS_FR: Record<CapitalSource, string> = {
  celiapp: "CELIAPP",
  rap_reer: "RAP (REER)",
  cash: "Épargne / comptant",
  gift: "Don",
  line_of_credit: "Marge de crédit",
  other: "Autre",
};
const NO_SOURCE_LABEL = "Non précisée";

export const CAPITAL_NOTE = "Ceci est un registre, pas un avis juridique. Les parts de propriété ne sont jamais présumées.";

const PAYMENT_FREQUENCIES = ["monthly", "semimonthly", "biweekly", "accelerated_biweekly", "weekly", "accelerated_weekly"] as const;

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

export type PropertyRow = {
  id: string;
  household_id: string;
  address_line: string | null;
  unit: string | null;
  city: string | null;
  postal_code: string | null;
  year_built: number | null;
  area_sqft: number | string | null;
  ownership_type: (typeof OWNERSHIP_TYPES)[number];
  purchase_date: string | null;
  purchase_price_cents: number | null;
  syndicate_name: string | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  agm_date: string | null;
  condo_fee_cents: number | null;
  condo_fee_contingency_cents: number | null;
  insurer: string | null;
  insurance_policy_number: string | null;
  insurance_renewal_on: string | null;
  insurance_premium_cents: number | null;
  syndicate_deductible_cents: number | null;
  owner_deductible_coverage_cents: number | null;
  welcome_tax_cents: number | null;
  welcome_tax_due_on: string | null;
  welcome_tax_paid_on: string | null;
  ownership_shares: Record<string, number> | null;
  created_at: string;
  updated_at: string;
};

const PROPERTY_SELECT =
  "id, household_id, address_line, unit, city, postal_code, year_built, area_sqft, ownership_type, purchase_date, purchase_price_cents, syndicate_name, manager_name, manager_email, manager_phone, agm_date, condo_fee_cents, condo_fee_contingency_cents, insurer, insurance_policy_number, insurance_renewal_on, insurance_premium_cents, syndicate_deductible_cents, owner_deductible_coverage_cents, welcome_tax_cents, welcome_tax_due_on, welcome_tax_paid_on, ownership_shares, created_at, updated_at";

export async function loadProperty(ctx: HouseholdCtx): Promise<PropertyRow | null> {
  return unwrap(
    await ctx.db.from("properties").select(PROPERTY_SELECT).eq("household_id", ctx.household.id).maybeSingle(),
  ) as PropertyRow | null;
}

async function ensureProperty(ctx: HouseholdCtx): Promise<PropertyRow> {
  const existing = await loadProperty(ctx);
  if (existing) return existing;
  unwrap(
    await ctx.db.from("properties").upsert({ household_id: ctx.household.id }, { onConflict: "household_id", ignoreDuplicates: true }),
  );
  const row = await loadProperty(ctx);
  if (!row) throw new AppError("INTERNAL", "Impossible de créer la fiche du condo.");
  return row;
}

export function ownershipSharesDto(ctx: HouseholdCtx, shares: Record<string, number> | null) {
  if (!shares || Object.keys(shares).length === 0) return null;
  return Object.entries(shares).map(([userId, bp]) => ({
    userId,
    name: memberName(ctx, userId),
    bp: Number(bp),
    percent: Number(bp) / 100,
    label: formatPct(Number(bp) / 100),
  }));
}

function toPropertyDto(ctx: HouseholdCtx, p: PropertyRow) {
  const t = today(ctx);
  return {
    id: p.id,
    addressLine: p.address_line,
    unit: p.unit,
    city: p.city,
    postalCode: p.postal_code,
    yearBuilt: p.year_built,
    areaSqft: num(p.area_sqft),
    ownershipType: p.ownership_type,
    ownershipTypeLabel: OWNERSHIP_TYPE_LABELS_FR[p.ownership_type] ?? p.ownership_type,
    purchaseDate: p.purchase_date,
    purchasePriceCents: num(p.purchase_price_cents),
    purchasePrice: fmt(p.purchase_price_cents),
    syndicate: {
      name: p.syndicate_name,
      managerName: p.manager_name,
      managerEmail: p.manager_email,
      managerPhone: p.manager_phone,
      agmDate: p.agm_date,
      daysUntilAgm: daysUntil(ctx, p.agm_date),
      condoFeeCents: num(p.condo_fee_cents),
      condoFee: fmt(p.condo_fee_cents),
      condoFeeContingencyCents: num(p.condo_fee_contingency_cents),
      condoFeeContingency: fmt(p.condo_fee_contingency_cents),
    },
    insurance: {
      insurer: p.insurer,
      policyNumber: p.insurance_policy_number,
      renewalOn: p.insurance_renewal_on,
      daysUntilRenewal: daysUntil(ctx, p.insurance_renewal_on),
      premiumCents: num(p.insurance_premium_cents),
      premium: fmt(p.insurance_premium_cents),
      syndicateDeductibleCents: num(p.syndicate_deductible_cents),
      syndicateDeductible: fmt(p.syndicate_deductible_cents),
      ownerDeductibleCoverageCents: num(p.owner_deductible_coverage_cents),
      ownerDeductibleCoverage: fmt(p.owner_deductible_coverage_cents),
    },
    welcomeTax: {
      amountCents: num(p.welcome_tax_cents),
      amount: fmt(p.welcome_tax_cents),
      dueOn: p.welcome_tax_due_on,
      paidOn: p.welcome_tax_paid_on,
      status: p.welcome_tax_paid_on
        ? ("paid" as const)
        : p.welcome_tax_due_on
          ? p.welcome_tax_due_on < t
            ? ("overdue" as const)
            : ("due" as const)
          : p.welcome_tax_cents
            ? ("unscheduled" as const)
            : ("unknown" as const),
      daysUntilDue: p.welcome_tax_paid_on ? null : daysUntil(ctx, p.welcome_tax_due_on),
    },
    ownershipShares: ownershipSharesDto(ctx, p.ownership_shares),
    updatedAt: p.updated_at,
  };
}

function normalizePostalCode(s: string): string {
  const up = s.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(up) ? `${up.slice(0, 3)} ${up.slice(3)}` : s.trim();
}

function ownershipSharesToBp(ctx: HouseholdCtx, shares: Record<string, number | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ref, raw] of Object.entries(shares)) {
    const userId = resolveMember(ctx, ref);
    const pct = parseDecimal(raw, "Part de propriété");
    if (pct < 0 || pct > 100) throw new AppError("VALIDATION", "Chaque part doit être entre 0 % et 100 %.");
    if (userId in out) throw new AppError("VALIDATION", "Une même personne apparaît deux fois dans les parts.");
    out[userId] = Math.round(pct * 100);
  }
  const total = Object.values(out).reduce((s, v) => s + v, 0);
  if (total !== 10_000) {
    throw new AppError("VALIDATION", `Les parts doivent totaliser 100 % (total actuel : ${formatPct(total / 100)}).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mortgage
// ---------------------------------------------------------------------------

export type MortgageRow = {
  id: string;
  household_id: string;
  property_id: string;
  lender: string | null;
  original_principal_cents: number | null;
  rate_pct: number | string | null;
  rate_type: "fixed" | "variable";
  term_months: number | null;
  start_date: string | null;
  renewal_date: string | null;
  amortization_months: number | null;
  payment_cents: number | null;
  payment_frequency: PaymentFrequency;
  prepayment_privilege_bp: number | null;
  prepayment_anniversary: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type StatementRow = { id: string; mortgage_id: string; balance_cents: number; as_of: string; created_by: string; created_at: string };
type PrepaymentRow = { id: string; mortgage_id: string; amount_cents: number; paid_on: string; paid_by: string | null; note: string | null; created_at: string };

const MORTGAGE_SELECT =
  "id, household_id, property_id, lender, original_principal_cents, rate_pct, rate_type, term_months, start_date, renewal_date, amortization_months, payment_cents, payment_frequency, prepayment_privilege_bp, prepayment_anniversary, notes, created_at, updated_at";

export const NO_MORTGAGE_MESSAGE = "Ajoute d'abord les infos de ton hypothèque.";

/** The household's mortgage (the most recently created one if several exist). */
export async function loadMortgage(ctx: HouseholdCtx, id?: string): Promise<MortgageRow | null> {
  let q = ctx.db.from("mortgages").select(MORTGAGE_SELECT).eq("household_id", ctx.household.id);
  if (id) q = q.eq("id", id);
  const rows = unwrap(await q.order("created_at", { ascending: false }).limit(1)) as MortgageRow[];
  if (id && rows.length === 0) throw new AppError("NOT_FOUND", "Hypothèque introuvable.");
  return rows[0] ?? null;
}

async function requireMortgage(ctx: HouseholdCtx, id?: string): Promise<MortgageRow> {
  const m = await loadMortgage(ctx, id);
  if (!m) throw new AppError("NOT_FOUND", NO_MORTGAGE_MESSAGE);
  return m;
}

async function latestStatement(ctx: HouseholdCtx, mortgageId: string): Promise<StatementRow | null> {
  const rows = unwrap(
    await ctx.db
      .from("mortgage_statements")
      .select("id, mortgage_id, balance_cents, as_of, created_by, created_at")
      .eq("household_id", ctx.household.id)
      .eq("mortgage_id", mortgageId)
      .order("as_of", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1),
  ) as StatementRow[];
  return rows[0] ?? null;
}

export async function loadPrepayments(ctx: HouseholdCtx, mortgageId: string): Promise<PrepaymentRow[]> {
  return selectAll<PrepaymentRow>((from, to) =>
    ctx.db
      .from("mortgage_prepayments")
      .select("id, mortgage_id, amount_cents, paid_on, paid_by, note, created_at")
      .eq("household_id", ctx.household.id)
      .eq("mortgage_id", mortgageId)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to),
  );
}

export const compoundingFor = (m: Pick<MortgageRow, "rate_type">): Compounding => (m.rate_type === "fixed" ? "semiannual" : "monthly");

/** Stored renewal date, or start + term when only those are known (flagged as estimated). */
export function effectiveRenewal(m: MortgageRow): { date: CivilDate | null; estimated: boolean } {
  if (m.renewal_date) return { date: m.renewal_date, estimated: false };
  if (m.start_date && m.term_months) return { date: addMonthsClamped(m.start_date, m.term_months), estimated: true };
  return { date: null, estimated: false };
}

function toMortgageDto(ctx: HouseholdCtx, m: MortgageRow) {
  const rate = num(m.rate_pct);
  const renewal = effectiveRenewal(m);
  return {
    id: m.id,
    propertyId: m.property_id,
    lender: m.lender,
    originalPrincipalCents: num(m.original_principal_cents),
    originalPrincipal: fmt(m.original_principal_cents),
    ratePct: rate,
    rate: rate === null ? null : formatPct(rate),
    rateType: m.rate_type,
    rateTypeLabel: m.rate_type === "fixed" ? "Fixe" : "Variable",
    compounding: compoundingFor(m),
    approximation: m.rate_type === "variable",
    termMonths: m.term_months,
    startDate: m.start_date,
    renewalDate: renewal.date,
    renewalEstimated: renewal.estimated,
    daysUntilRenewal: daysUntil(ctx, renewal.date),
    amortizationMonths: m.amortization_months,
    paymentCents: num(m.payment_cents),
    payment: fmt(m.payment_cents),
    paymentFrequency: m.payment_frequency,
    paymentFrequencyLabel: PAYMENT_FREQUENCY_LABELS_FR[m.payment_frequency] ?? m.payment_frequency,
    prepaymentPrivilegeBp: m.prepayment_privilege_bp,
    prepaymentPrivilegePct: m.prepayment_privilege_bp === null ? null : m.prepayment_privilege_bp / 100,
    prepaymentAnniversary: m.prepayment_anniversary,
    notes: m.notes,
    updatedAt: m.updated_at,
  };
}

function toPrepaymentDto(ctx: HouseholdCtx, p: PrepaymentRow) {
  return {
    id: p.id,
    amountCents: Number(p.amount_cents),
    amount: formatMoney(Number(p.amount_cents)),
    paidOn: p.paid_on,
    paidBy: p.paid_by ? { userId: p.paid_by, name: memberName(ctx, p.paid_by) } : null,
    note: p.note,
    createdAt: p.created_at,
  };
}

function toStatementDto(s: StatementRow) {
  return { id: s.id, balanceCents: Number(s.balance_cents), balance: formatMoney(Number(s.balance_cents)), asOf: s.as_of, createdAt: s.created_at };
}

export type PrivilegeDto = {
  allowedCents: number;
  allowed: string;
  usedCents: number;
  used: string;
  remainingCents: number;
  remaining: string;
  yearStart: CivilDate;
  /** Last day of the privilege year (inclusive). */
  yearEnd: CivilDate;
  yearEndExclusive: CivilDate;
  privilegePct: number;
};

/** Remaining prepayment privilege for the current anniversary year, or a reason why it can't be computed. */
export function mortgagePrivilege(
  ctx: HouseholdCtx,
  m: MortgageRow,
  prepayments: Pick<PrepaymentRow, "amount_cents" | "paid_on">[],
): { privilege: PrivilegeDto | null; reason: string | null } {
  const anniversary = m.prepayment_anniversary ?? m.start_date;
  if (m.prepayment_privilege_bp === null) return { privilege: null, reason: "Ajoute le privilège de remboursement anticipé (ex. 15 %) de ton prêt." };
  if (!m.original_principal_cents) return { privilege: null, reason: "Ajoute le capital d'origine du prêt pour calculer ton privilège annuel." };
  if (!anniversary) return { privilege: null, reason: "Ajoute la date de début du prêt ou la date d'anniversaire du privilège." };
  const p = prepaymentPrivilege({
    originalPrincipalCents: Number(m.original_principal_cents),
    privilegeBp: m.prepayment_privilege_bp,
    anniversaryDate: anniversary,
    prepayments: prepayments.map((x) => ({ amountCents: Number(x.amount_cents), paidOn: x.paid_on })),
    today: today(ctx),
  });
  return {
    privilege: {
      allowedCents: p.allowedCents,
      allowed: formatMoney(p.allowedCents),
      usedCents: p.usedCents,
      used: formatMoney(p.usedCents),
      remainingCents: p.remainingCents,
      remaining: formatMoney(p.remainingCents),
      yearStart: p.yearStart,
      yearEnd: addDays(p.yearEndExclusive, -1),
      yearEndExclusive: p.yearEndExclusive,
      privilegePct: m.prepayment_privilege_bp / 100,
    },
    reason: null,
  };
}

/** First payment date on the grid anchored at `anchor` (k ≥ 1) strictly after `after`. */
function nextGridDate(anchor: CivilDate, freq: PaymentFrequency, after: CivilDate): CivilDate {
  let k = 1;
  if (freq !== "monthly" && freq !== "semimonthly") {
    const step = freq === "weekly" || freq === "accelerated_weekly" ? 7 : 14;
    k = Math.max(1, Math.floor(diffDays(anchor, after) / step) - 1);
  }
  for (let i = 0; i < 6000; i++, k++) {
    const d = paymentDate(anchor, freq, k);
    if (d > after) return d;
  }
  throw new AppError("VALIDATION", "Impossible de situer le prochain versement.");
}

function scheduleRowDto(r: ScheduleRow) {
  return {
    n: r.n,
    date: r.date,
    paymentCents: r.paymentCents,
    payment: formatMoney(r.paymentCents),
    interestCents: r.interestCents,
    interest: formatMoney(r.interestCents),
    principalCents: r.principalCents,
    principal: formatMoney(r.principalCents),
    balanceCents: r.balanceCents,
    balance: formatMoney(r.balanceCents),
  };
}

/**
 * Projection from a known balance only: the latest lender statement (preferred) or the
 * original principal at the start date. Principal is never invented.
 */
export function mortgageProjection(ctx: HouseholdCtx, m: MortgageRow, statement: StatementRow | null, prepayments: PrepaymentRow[]) {
  const t = today(ctx);
  const compounding = compoundingFor(m);
  const approximation = m.rate_type === "variable";
  const base = statement
    ? { source: "statement" as const, balanceCents: Number(statement.balance_cents), asOf: statement.as_of }
    : m.original_principal_cents && m.start_date
      ? { source: "original" as const, balanceCents: Number(m.original_principal_cents), asOf: m.start_date }
      : null;
  const balance = base
    ? { source: base.source, balanceCents: base.balanceCents, balance: formatMoney(base.balanceCents), asOf: base.asOf }
    : null;
  const fail = (reason: string) => ({ balance, compounding, approximation, schedule: null, reason });

  if (!base) {
    return fail(
      m.original_principal_cents
        ? "Ajoute la date de début du prêt, ou mieux : le solde de ton dernier relevé du prêteur."
        : "Ajoute le solde de ton dernier relevé du prêteur (ou le capital d'origine et la date de début).",
    );
  }
  const rate = num(m.rate_pct);
  if (rate === null) return fail("Ajoute le taux d'intérêt de ton hypothèque.");

  let paymentCents = num(m.payment_cents);
  let paymentSource: "entered" | "computed" = "entered";
  if (paymentCents === null) {
    if (!m.original_principal_cents || !m.amortization_months) {
      return fail("Ajoute le montant de ton versement hypothécaire (ou la période d'amortissement).");
    }
    paymentCents = computePayment({
      principalCents: Number(m.original_principal_cents),
      annualRatePct: rate,
      amortizationMonths: m.amortization_months,
      frequency: m.payment_frequency,
      compounding,
    });
    paymentSource = "computed";
  }

  try {
    const anchor = m.start_date ?? base.asOf;
    const freq = m.payment_frequency;
    const fromBase = amortizationSchedule({
      balanceCents: base.balanceCents,
      annualRatePct: rate,
      paymentCents,
      frequency: freq,
      compounding,
      startDate: nextGridDate(anchor, freq, base.asOf),
    });
    const paidRows = fromBase.filter((r) => r.date <= t);
    const scheduledBalance = paidRows.length ? paidRows[paidRows.length - 1].balanceCents : base.balanceCents;
    const prepaymentsSinceCents = prepayments
      .filter((p) => p.paid_on > base.asOf && p.paid_on <= t)
      .reduce((s, p) => s + Number(p.amount_cents), 0);
    const currentCents = Math.max(0, scheduledBalance - prepaymentsSinceCents);
    const forward =
      currentCents === 0
        ? []
        : amortizationSchedule({
            balanceCents: currentCents,
            annualRatePct: rate,
            paymentCents,
            frequency: freq,
            compounding,
            startDate: nextGridDate(anchor, freq, t),
          });
    const sum = summarizeMortgage(forward);
    const renewal = effectiveRenewal(m).date;
    const atRenewal = renewal ? [...forward].reverse().find((r) => r.date <= renewal) : undefined;
    return {
      balance,
      compounding,
      approximation,
      reason: null,
      schedule: {
        paymentCents,
        payment: formatMoney(paymentCents),
        paymentSource,
        estimatedBalanceCents: currentCents,
        estimatedBalance: formatMoney(currentCents),
        /** True when payments or prepayments since the reference date were simulated. */
        balanceIsEstimate: paidRows.length > 0 || prepaymentsSinceCents > 0,
        paymentsSinceReference: paidRows.length,
        prepaymentsSinceReferenceCents: prepaymentsSinceCents,
        prepaymentsSinceReference: formatMoney(prepaymentsSinceCents),
        next: forward.slice(0, 12).map(scheduleRowDto),
        remainingPayments: sum.periods,
        projectedPayoffDate: sum.payoffDate,
        paidOff: currentCents === 0,
        totalInterestRemainingCents: sum.totalInterestCents,
        totalInterestRemaining: formatMoney(sum.totalInterestCents),
        balanceAtRenewalCents: renewal ? (atRenewal ? atRenewal.balanceCents : currentCents) : null,
        balanceAtRenewal: renewal ? formatMoney(atRenewal ? atRenewal.balanceCents : currentCents) : null,
        note:
          (base.source === "original"
            ? "Projection à partir du capital d'origine : ajoute un relevé de ton prêteur pour plus de précision. "
            : "Projection à partir du solde de ton dernier relevé. ") +
          (approximation ? "Taux variable : intérêts composés mensuellement (approximation, selon le prêteur)." : "Taux fixe : intérêts composés semestriellement (Loi sur l'intérêt)."),
      },
    };
  } catch (e) {
    if (isDomainError(e)) return fail(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Special assessments
// ---------------------------------------------------------------------------

type AssessmentRow = { id: string; title: string; amount_cents: number; due_on: string | null; paid_on: string | null; notes: string | null; created_at: string };

export async function loadAssessments(ctx: HouseholdCtx): Promise<AssessmentRow[]> {
  return unwrap(
    await ctx.db
      .from("special_assessments")
      .select("id, title, amount_cents, due_on, paid_on, notes, created_at")
      .eq("household_id", ctx.household.id)
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ) as AssessmentRow[];
}

function toAssessmentDto(ctx: HouseholdCtx, a: AssessmentRow) {
  const t = today(ctx);
  return {
    id: a.id,
    title: a.title,
    amountCents: Number(a.amount_cents),
    amount: formatMoney(Number(a.amount_cents)),
    dueOn: a.due_on,
    paidOn: a.paid_on,
    status: a.paid_on ? ("paid" as const) : !a.due_on ? ("unscheduled" as const) : a.due_on < t ? ("overdue" as const) : ("upcoming" as const),
    daysUntilDue: a.paid_on ? null : daysUntil(ctx, a.due_on),
    notes: a.notes,
  };
}

function assessmentsSummary(ctx: HouseholdCtx, rows: AssessmentRow[]) {
  const items = rows.map((r) => toAssessmentDto(ctx, r));
  const unpaid = items.filter((a) => a.status !== "paid").reduce((s, a) => s + a.amountCents, 0);
  return { assessments: items, unpaidTotalCents: unpaid, unpaidTotal: formatMoney(unpaid) };
}

// ---------------------------------------------------------------------------
// Ops — property & mortgage
// ---------------------------------------------------------------------------

export const getProperty = defineOp({
  name: "condo.getProperty",
  kind: "read",
  input: z.object({}),
  run: async (ctx) => {
    const [property, mortgage, assessments] = await Promise.all([loadProperty(ctx), loadMortgage(ctx), loadAssessments(ctx)]);
    const sa = assessmentsSummary(ctx, assessments);
    if (!property) {
      return {
        property: null,
        mortgage: null,
        privilege: null,
        privilegeReason: null,
        latestStatement: null,
        ...sa,
        message: "Ajoute d'abord les infos de ton condo.",
      };
    }
    let privilege: PrivilegeDto | null = null;
    let privilegeReason: string | null = mortgage ? null : NO_MORTGAGE_MESSAGE;
    let statement: StatementRow | null = null;
    if (mortgage) {
      const [st, prepayments] = await Promise.all([latestStatement(ctx, mortgage.id), loadPrepayments(ctx, mortgage.id)]);
      statement = st;
      ({ privilege, reason: privilegeReason } = mortgagePrivilege(ctx, mortgage, prepayments));
    }
    return {
      property: toPropertyDto(ctx, property),
      mortgage: mortgage ? toMortgageDto(ctx, mortgage) : null,
      privilege,
      privilegeReason,
      latestStatement: statement ? toStatementDto(statement) : null,
      ...sa,
      message: mortgage ? null : NO_MORTGAGE_MESSAGE,
    };
  },
});

const zMoneyOpt = zMoney.nullable().optional();

export const upsertProperty = defineOp({
  name: "condo.upsertProperty",
  kind: "write",
  input: z.object({
    addressLine: zOptText(200),
    unit: zOptText(20),
    city: zOptText(80),
    postalCode: zOptText(10),
    yearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
    areaSqft: zDecimal.nullable().optional(),
    ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
    purchaseDate: zDay.nullable().optional(),
    purchasePrice: zMoneyOpt,
    syndicateName: zOptText(160),
    managerName: zOptText(120),
    managerEmail: z.string().trim().email("Courriel invalide.").max(200).nullable().optional(),
    managerPhone: zOptText(40),
    agmDate: zDay.nullable().optional(),
    condoFee: zMoneyOpt,
    condoFeeContingency: zMoneyOpt,
    insurer: zOptText(120),
    insurancePolicyNumber: zOptText(80),
    insuranceRenewalOn: zDay.nullable().optional(),
    insurancePremium: zMoneyOpt,
    syndicateDeductible: zMoneyOpt,
    ownerDeductibleCoverage: zMoneyOpt,
    welcomeTax: zMoneyOpt,
    welcomeTaxDueOn: zDay.nullable().optional(),
    welcomeTaxPaidOn: zDay.nullable().optional(),
    /** Member ref ("moi", name, id) → percent. Must total 100 %. null clears. */
    ownershipShares: z.record(z.string(), zDecimal).nullable().optional(),
  }),
  run: async (ctx, input) => {
    const row: Record<string, unknown> = {};
    const cents = (m: z.infer<typeof zMoney>) => moneyToCents(m);
    put(row, "address_line", input.addressLine);
    put(row, "unit", input.unit);
    put(row, "city", input.city);
    put(row, "postal_code", input.postalCode, normalizePostalCode);
    put(row, "year_built", input.yearBuilt);
    put(row, "area_sqft", input.areaSqft, (v) => {
      const n = parseDecimal(v, "Superficie");
      if (n <= 0) throw new AppError("VALIDATION", "La superficie doit être plus grande que zéro.");
      return Math.round(n * 10) / 10;
    });
    put(row, "ownership_type", input.ownershipType);
    put(row, "purchase_date", input.purchaseDate);
    put(row, "purchase_price_cents", input.purchasePrice, (v) => {
      const c = cents(v);
      if (c <= 0) throw new AppError("VALIDATION", "Le prix d'achat doit être plus grand que zéro.");
      return c;
    });
    put(row, "syndicate_name", input.syndicateName);
    put(row, "manager_name", input.managerName);
    put(row, "manager_email", input.managerEmail);
    put(row, "manager_phone", input.managerPhone);
    put(row, "agm_date", input.agmDate);
    put(row, "condo_fee_cents", input.condoFee, cents);
    put(row, "condo_fee_contingency_cents", input.condoFeeContingency, cents);
    put(row, "insurer", input.insurer);
    put(row, "insurance_policy_number", input.insurancePolicyNumber);
    put(row, "insurance_renewal_on", input.insuranceRenewalOn);
    put(row, "insurance_premium_cents", input.insurancePremium, cents);
    put(row, "syndicate_deductible_cents", input.syndicateDeductible, cents);
    put(row, "owner_deductible_coverage_cents", input.ownerDeductibleCoverage, cents);
    put(row, "welcome_tax_cents", input.welcomeTax, cents);
    put(row, "welcome_tax_due_on", input.welcomeTaxDueOn);
    put(row, "welcome_tax_paid_on", input.welcomeTaxPaidOn);
    put(row, "ownership_shares", input.ownershipShares, (v) => ownershipSharesToBp(ctx, v));

    const existed = (await loadProperty(ctx)) !== null;
    unwrap(await ctx.db.from("properties").upsert({ ...row, household_id: ctx.household.id }, { onConflict: "household_id" }));
    const saved = await loadProperty(ctx);
    if (!saved) throw new AppError("INTERNAL", "Impossible d'enregistrer la fiche du condo.");
    return { property: toPropertyDto(ctx, saved), created: !existed };
  },
});

export const upsertMortgage = defineOp({
  name: "condo.upsertMortgage",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    lender: zOptText(120),
    originalPrincipal: zMoneyOpt,
    /** Annual rate in percent: 4.79 or "4,79". */
    rate: zDecimal.nullable().optional(),
    rateType: z.enum(["fixed", "variable"]).optional(),
    termMonths: z.number().int().min(1).max(120).nullable().optional(),
    termYears: z.number().min(0.1).max(10).optional(),
    startDate: zDay.nullable().optional(),
    renewalDate: zDay.nullable().optional(),
    amortizationMonths: z.number().int().min(12).max(480).nullable().optional(),
    amortizationYears: z.number().min(1).max(40).optional(),
    payment: zMoneyOpt,
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES).optional(),
    /** Annual prepayment privilege in percent of the original principal (e.g. 15 or "15 %"). */
    prepaymentPrivilegePct: zDecimal.nullable().optional(),
    prepaymentAnniversary: zDay.nullable().optional(),
    notes: zOptText(2000),
  }),
  run: async (ctx, input) => {
    const property = await ensureProperty(ctx);
    const current = input.id ? await requireMortgage(ctx, input.id) : await loadMortgage(ctx);

    const row: Record<string, unknown> = {};
    put(row, "lender", input.lender);
    put(row, "original_principal_cents", input.originalPrincipal, (v) => {
      const c = moneyToCents(v);
      if (c <= 0) throw new AppError("VALIDATION", "Le capital d'origine doit être plus grand que zéro.");
      return c;
    });
    put(row, "rate_pct", input.rate, (v) => {
      const r = parseDecimal(v, "Taux d'intérêt");
      if (r < 0 || r >= 30) throw new AppError("VALIDATION", "Le taux doit être entre 0 % et 30 %.");
      return Math.round(r * 10_000) / 10_000;
    });
    put(row, "rate_type", input.rateType);
    put(row, "term_months", input.termYears !== undefined ? Math.round(input.termYears * 12) : input.termMonths);
    put(row, "start_date", input.startDate);
    put(row, "renewal_date", input.renewalDate);
    put(row, "amortization_months", input.amortizationYears !== undefined ? Math.round(input.amortizationYears * 12) : input.amortizationMonths);
    put(row, "payment_cents", input.payment, (v) => {
      const c = moneyToCents(v);
      if (c <= 0) throw new AppError("VALIDATION", "Le versement doit être plus grand que zéro.");
      return c;
    });
    put(row, "payment_frequency", input.paymentFrequency);
    put(row, "prepayment_privilege_bp", input.prepaymentPrivilegePct, (v) => {
      const p = parseDecimal(v, "Privilège de remboursement anticipé");
      if (p < 0 || p > 100) throw new AppError("VALIDATION", "Le privilège doit être entre 0 % et 100 %.");
      return Math.round(p * 100);
    });
    put(row, "prepayment_anniversary", input.prepaymentAnniversary);
    put(row, "notes", input.notes);

    let id: string;
    if (current) {
      id = current.id;
      if (Object.keys(row).length > 0) {
        unwrap(await ctx.db.from("mortgages").update(row).eq("household_id", ctx.household.id).eq("id", id));
      }
    } else {
      const created = unwrap(
        await ctx.db
          .from("mortgages")
          .insert({ ...row, household_id: ctx.household.id, property_id: property.id })
          .select("id")
          .single(),
      ) as { id: string };
      id = created.id;
    }
    const saved = await requireMortgage(ctx, id);
    return { mortgage: toMortgageDto(ctx, saved), created: !current };
  },
});

export const addPrepayment = defineOp({
  name: "condo.addPrepayment",
  kind: "write",
  input: z.object({
    amount: zMoney,
    paidOn: zDay.optional(),
    /** Who paid: "moi", partner name or id. Optional. */
    paidBy: z.string().max(100).optional(),
    note: z.string().trim().max(500).optional(),
    mortgageId: z.string().uuid().optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "condo.addPrepayment", input, async () => {
      const m = await requireMortgage(ctx, input.mortgageId);
      const amountCents = moneyToCents(input.amount);
      if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
      const paidOn = input.paidOn ?? today(ctx);
      if (paidOn > today(ctx)) throw new AppError("VALIDATION", "La date du remboursement ne peut pas être dans le futur.");
      const before = mortgagePrivilege(ctx, m, await loadPrepayments(ctx, m.id)).privilege;
      const row = unwrap(
        await ctx.db
          .from("mortgage_prepayments")
          .insert({
            household_id: ctx.household.id,
            mortgage_id: m.id,
            amount_cents: amountCents,
            paid_on: paidOn,
            paid_by: input.paidBy ? resolveMember(ctx, input.paidBy) : null,
            note: input.note ?? null,
          })
          .select("id, mortgage_id, amount_cents, paid_on, paid_by, note, created_at")
          .single(),
      ) as PrepaymentRow;
      const after = mortgagePrivilege(ctx, m, await loadPrepayments(ctx, m.id)).privilege;
      const inYear = before && paidOn >= before.yearStart && paidOn < before.yearEndExclusive;
      const warning =
        inYear && before && amountCents > before.remainingCents
          ? `Ce versement dépasse ton privilège annuel restant (${before.remaining}). Vérifie avec ton prêteur : des pénalités pourraient s'appliquer.`
          : null;
      return { prepayment: toPrepaymentDto(ctx, row), privilege: after, warning };
    }),
});

export const addStatement = defineOp({
  name: "condo.addStatement",
  kind: "write",
  input: z.object({
    /** Balance shown on the lender's statement. */
    balance: zMoney,
    asOf: zDay.optional(),
    mortgageId: z.string().uuid().optional(),
  }),
  run: async (ctx, input) => {
    const m = await requireMortgage(ctx, input.mortgageId);
    const asOf = input.asOf ?? today(ctx);
    if (asOf > today(ctx)) throw new AppError("VALIDATION", "La date du relevé ne peut pas être dans le futur.");
    const row = unwrap(
      await ctx.db
        .from("mortgage_statements")
        .insert({ household_id: ctx.household.id, mortgage_id: m.id, balance_cents: moneyToCents(input.balance), as_of: asOf })
        .select("id, mortgage_id, balance_cents, as_of, created_by, created_at")
        .single(),
    ) as StatementRow;
    return { statement: toStatementDto(row) };
  },
});

export const getMortgageSummary = defineOp({
  name: "condo.getMortgageSummary",
  kind: "read",
  input: z.object({ mortgageId: z.string().uuid().optional() }),
  run: async (ctx, input) => {
    const m = await loadMortgage(ctx, input.mortgageId);
    if (!m) {
      return {
        mortgage: null,
        balance: null,
        schedule: null,
        reason: NO_MORTGAGE_MESSAGE,
        approximation: false,
        compounding: null,
        privilege: null,
        privilegeReason: NO_MORTGAGE_MESSAGE,
        prepayments: [],
        latestStatement: null,
        renewal: null,
      };
    }
    const [statement, prepayments] = await Promise.all([latestStatement(ctx, m.id), loadPrepayments(ctx, m.id)]);
    const projection = mortgageProjection(ctx, m, statement, prepayments);
    const { privilege, reason: privilegeReason } = mortgagePrivilege(ctx, m, prepayments);
    const renewal = effectiveRenewal(m);
    const prepaidTotal = prepayments.reduce((s, p) => s + Number(p.amount_cents), 0);
    return {
      mortgage: toMortgageDto(ctx, m),
      ...projection,
      privilege,
      privilegeReason,
      prepayments: prepayments.map((p) => toPrepaymentDto(ctx, p)),
      prepaymentsTotalCents: prepaidTotal,
      prepaymentsTotal: formatMoney(prepaidTotal),
      latestStatement: statement ? toStatementDto(statement) : null,
      renewal: renewal.date ? { date: renewal.date, estimated: renewal.estimated, daysUntil: daysUntil(ctx, renewal.date) } : null,
    };
  },
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type DocumentRow = {
  id: string;
  title: string;
  doc_type: DocType;
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  note_id: string | null;
  appliance_id: string | null;
  document_date: string | null;
  created_by: string;
  created_at: string;
};
const DOCUMENT_SELECT = "id, title, doc_type, storage_path, external_url, mime_type, size_bytes, note_id, appliance_id, document_date, created_by, created_at";
const BUCKET = "household-files";

function linkProvider(u: string): "google_drive" | "external" {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host === "drive.google.com" || host === "docs.google.com" || host.endsWith(".drive.google.com") ? "google_drive" : "external";
  } catch {
    return "external";
  }
}

function toDocumentDto(ctx: HouseholdCtx, d: DocumentRow) {
  return {
    id: d.id,
    title: d.title,
    docType: d.doc_type,
    docTypeLabel: DOC_TYPE_LABELS_FR[d.doc_type] ?? d.doc_type,
    kind: d.storage_path ? ("file" as const) : ("link" as const),
    provider: d.storage_path ? ("storage" as const) : linkProvider(d.external_url ?? ""),
    storagePath: d.storage_path,
    externalUrl: d.external_url,
    mimeType: d.mime_type,
    sizeBytes: num(d.size_bytes),
    noteId: d.note_id,
    applianceId: d.appliance_id,
    documentDate: d.document_date,
    createdBy: { userId: d.created_by, name: memberName(ctx, d.created_by) },
    createdAt: d.created_at,
  };
}

async function fetchDocument(ctx: HouseholdCtx, id: string): Promise<DocumentRow> {
  const row = unwrap(
    await ctx.db.from("documents").select(DOCUMENT_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle(),
  ) as DocumentRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Document introuvable.");
  return row;
}

export const listDocuments = defineOp({
  name: "condo.listDocuments",
  kind: "read",
  input: z.object({
    docType: z.enum(DOC_TYPES).optional(),
    applianceId: z.string().uuid().optional(),
    /** Include files attached to notes (excluded by default). */
    includeNoteAttachments: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  run: async (ctx, input) => {
    let q = ctx.db.from("documents").select(DOCUMENT_SELECT).eq("household_id", ctx.household.id);
    if (input.docType) q = q.eq("doc_type", input.docType);
    if (input.applianceId) q = q.eq("appliance_id", input.applianceId);
    if (!input.includeNoteAttachments) q = q.is("note_id", null);
    const rows = unwrap(await q.order("created_at", { ascending: false }).limit(input.limit)) as DocumentRow[];
    const documents = rows.map((r) => toDocumentDto(ctx, r));
    const counts: Partial<Record<DocType, number>> = {};
    for (const d of documents) counts[d.docType] = (counts[d.docType] ?? 0) + 1;
    return { documents, counts, docTypes: DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS_FR[t] })) };
  },
});

export const addDocument = defineOp({
  name: "condo.addDocument",
  kind: "write",
  input: z.object({
    title: z.string().trim().min(1, "Ajoute un titre.").max(160),
    docType: z.enum(DOC_TYPES).default("other"),
    /** Path in the household-files bucket: `<household_id>/documents/<file>`. */
    storagePath: z.string().max(500).optional(),
    /** Link to a file hosted elsewhere (e.g. Google Drive). */
    externalUrl: z.string().trim().max(2000).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().nonnegative().max(1_000_000_000).optional(),
    applianceId: z.string().uuid().optional(),
    /** Attach to a note instead (privacy follows the note through RLS). */
    noteId: z.string().uuid().optional(),
    documentDate: zDay.optional(),
  }),
  run: async (ctx, input) => {
    if (!!input.storagePath === !!input.externalUrl) {
      throw new AppError("VALIDATION", "Téléverse un fichier ou colle un lien (un des deux).");
    }
    let storagePath: string | null = null;
    let externalUrl: string | null = null;
    if (input.storagePath) {
      const prefix = `${ctx.household.id}/documents/`;
      if (!input.storagePath.startsWith(prefix) || input.storagePath.length <= prefix.length || input.storagePath.includes("..")) {
        throw new AppError("FORBIDDEN", "Ce fichier n'appartient pas aux documents de ton foyer.");
      }
      storagePath = input.storagePath;
    } else {
      externalUrl = cleanUrl(input.externalUrl!);
    }
    if (input.applianceId) await assertAppliance(ctx, input.applianceId);
    if (input.noteId) {
      // RLS hides the partner's private notes, so "not found" covers both cases.
      const note = unwrap(await ctx.db.from("notes").select("id").eq("household_id", ctx.household.id).eq("id", input.noteId).maybeSingle());
      if (!note) throw new AppError("NOT_FOUND", "Note introuvable.");
    }
    const row = unwrap(
      await ctx.db
        .from("documents")
        .insert({
          household_id: ctx.household.id,
          title: input.title,
          doc_type: input.docType,
          storage_path: storagePath,
          external_url: externalUrl,
          mime_type: input.mimeType ?? null,
          size_bytes: input.sizeBytes ?? null,
          appliance_id: input.applianceId ?? null,
          note_id: input.noteId ?? null,
          document_date: input.documentDate ?? null,
        })
        .select(DOCUMENT_SELECT)
        .single(),
    ) as DocumentRow;
    return { document: toDocumentDto(ctx, row) };
  },
});

export const deleteDocument = defineOp({
  name: "condo.deleteDocument",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const doc = await fetchDocument(ctx, input.id);
    unwrap(await ctx.db.from("documents").delete().eq("household_id", ctx.household.id).eq("id", doc.id));
    let fileRemoved = false;
    if (doc.storage_path) {
      const res = await ctx.db.storage.from(BUCKET).remove([doc.storage_path]);
      fileRemoved = !res.error;
      if (res.error) console.error("[storage] remove failed", res.error.message);
    }
    return { deleted: toDocumentDto(ctx, doc), fileRemoved };
  },
});

export const documentUrl = defineOp({
  name: "condo.documentUrl",
  kind: "read",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const doc = await fetchDocument(ctx, input.id);
    if (doc.external_url) {
      return { url: doc.external_url, kind: "link" as const, provider: linkProvider(doc.external_url), expiresInSeconds: null };
    }
    const res = await ctx.db.storage.from(BUCKET).createSignedUrl(doc.storage_path!, 300);
    if (res.error || !res.data?.signedUrl) throw new AppError("NOT_FOUND", "Le fichier est introuvable dans le stockage.");
    return { url: res.data.signedUrl, kind: "file" as const, provider: "storage" as const, expiresInSeconds: 300 };
  },
});

// ---------------------------------------------------------------------------
// Appliances
// ---------------------------------------------------------------------------

type ApplianceRow = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchased_on: string | null;
  warranty_ends_on: string | null;
  manual_url: string | null;
  price_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
const APPLIANCE_SELECT = "id, name, brand, model, serial_number, purchased_on, warranty_ends_on, manual_url, price_cents, notes, created_at, updated_at";

export async function loadAppliances(ctx: HouseholdCtx): Promise<ApplianceRow[]> {
  return unwrap(
    await ctx.db.from("appliances").select(APPLIANCE_SELECT).eq("household_id", ctx.household.id).order("name"),
  ) as ApplianceRow[];
}

function toApplianceDto(ctx: HouseholdCtx, a: ApplianceRow, documentsCount = 0) {
  const left = a.warranty_ends_on ? diffDays(today(ctx), a.warranty_ends_on) : null;
  return {
    id: a.id,
    name: a.name,
    brand: a.brand,
    model: a.model,
    serialNumber: a.serial_number,
    purchasedOn: a.purchased_on,
    warrantyEndsOn: a.warranty_ends_on,
    warranty: {
      status: left === null ? ("unknown" as const) : left >= 0 ? ("active" as const) : ("expired" as const),
      daysLeft: left,
    },
    manualUrl: a.manual_url,
    priceCents: num(a.price_cents),
    price: fmt(a.price_cents),
    notes: a.notes,
    documentsCount,
    updatedAt: a.updated_at,
  };
}

export const listAppliances = defineOp({
  name: "condo.listAppliances",
  kind: "read",
  input: z.object({}),
  run: async (ctx) => {
    const [rows, docs] = await Promise.all([
      loadAppliances(ctx),
      ctx.db.from("documents").select("appliance_id").eq("household_id", ctx.household.id).not("appliance_id", "is", null),
    ]);
    const counts = new Map<string, number>();
    for (const d of unwrap(docs) as { appliance_id: string }[]) counts.set(d.appliance_id, (counts.get(d.appliance_id) ?? 0) + 1);
    return { appliances: rows.map((r) => toApplianceDto(ctx, r, counts.get(r.id) ?? 0)) };
  },
});

export const upsertAppliance = defineOp({
  name: "condo.upsertAppliance",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Donne un nom à l'appareil.").max(80).optional(),
    brand: zOptText(80),
    model: zOptText(80),
    serialNumber: zOptText(80),
    purchasedOn: zDay.nullable().optional(),
    warrantyEndsOn: zDay.nullable().optional(),
    /** Convenience: warranty length from the purchase date (ignored if warrantyEndsOn is given). */
    warrantyMonths: z.number().int().min(1).max(600).optional(),
    manualUrl: z.string().trim().max(2000).nullable().optional(),
    price: zMoneyOpt,
    notes: zOptText(2000),
  }),
  run: async (ctx, input) => {
    const current = input.id ? await assertAppliance(ctx, input.id) : null;
    if (!current && !input.name) throw new AppError("VALIDATION", "Donne un nom à l'appareil.");
    const row: Record<string, unknown> = {};
    put(row, "name", input.name);
    put(row, "brand", input.brand);
    put(row, "model", input.model);
    put(row, "serial_number", input.serialNumber);
    put(row, "purchased_on", input.purchasedOn);
    put(row, "warranty_ends_on", input.warrantyEndsOn);
    if (input.warrantyEndsOn === undefined && input.warrantyMonths !== undefined) {
      let purchased = input.purchasedOn ?? null;
      if (!purchased && current) {
        const cur = unwrap(
          await ctx.db.from("appliances").select("purchased_on").eq("household_id", ctx.household.id).eq("id", current.id).single(),
        ) as { purchased_on: string | null };
        purchased = cur.purchased_on;
      }
      if (!purchased) throw new AppError("VALIDATION", "Ajoute la date d'achat pour calculer la fin de la garantie.");
      row.warranty_ends_on = addDays(addMonthsClamped(purchased, input.warrantyMonths), -1);
    }
    put(row, "manual_url", input.manualUrl, cleanUrl);
    put(row, "price_cents", input.price, (v) => moneyToCents(v));
    put(row, "notes", input.notes);

    let saved: ApplianceRow;
    if (current) {
      saved = unwrap(
        await ctx.db.from("appliances").update(row).eq("household_id", ctx.household.id).eq("id", current.id).select(APPLIANCE_SELECT).single(),
      ) as ApplianceRow;
    } else {
      saved = unwrap(
        await ctx.db.from("appliances").insert({ ...row, household_id: ctx.household.id }).select(APPLIANCE_SELECT).single(),
      ) as ApplianceRow;
    }
    return { appliance: toApplianceDto(ctx, saved), created: !current };
  },
});

export const deleteAppliance = defineOp({
  name: "condo.deleteAppliance",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const row = unwrap(
      await ctx.db.from("appliances").delete().eq("household_id", ctx.household.id).eq("id", input.id).select(APPLIANCE_SELECT).maybeSingle(),
    ) as ApplianceRow | null;
    if (!row) throw new AppError("NOT_FOUND", "Appareil introuvable.");
    return { deleted: toApplianceDto(ctx, row) };
  },
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

type MaintenanceTaskRow = {
  id: string;
  title: string;
  notes: string | null;
  due_on: string | null;
  assignee: string | null;
  priority: number;
  frequency: string | null;
  appliance_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
};
type MaintenanceRecordRow = {
  id: string;
  title: string;
  done_on: string;
  appliance_id: string | null;
  task_id: string | null;
  cost_cents: number | null;
  expense_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};
const RECORD_SELECT = "id, title, done_on, appliance_id, task_id, cost_cents, expense_id, notes, created_by, created_at";

function toRecordDto(ctx: HouseholdCtx, r: MaintenanceRecordRow, applianceNames: Map<string, string>) {
  return {
    id: r.id,
    title: r.title,
    doneOn: r.done_on,
    appliance: r.appliance_id ? { id: r.appliance_id, name: applianceNames.get(r.appliance_id) ?? "Appareil" } : null,
    taskId: r.task_id,
    costCents: num(r.cost_cents),
    cost: fmt(r.cost_cents),
    expenseId: r.expense_id,
    notes: r.notes,
    createdBy: { userId: r.created_by, name: memberName(ctx, r.created_by) },
    createdAt: r.created_at,
  };
}

export const listMaintenance = defineOp({
  name: "condo.listMaintenance",
  kind: "read",
  input: z.object({
    applianceId: z.string().uuid().optional(),
    historyLimit: z.number().int().min(1).max(500).default(100),
    completedLimit: z.number().int().min(0).max(100).default(20),
  }),
  run: async (ctx, input) => {
    const hid = ctx.household.id;
    const TASK_SELECT = "id, title, notes, due_on, assignee, priority, frequency, appliance_id, completed_at, completed_by";
    let openQ = ctx.db.from("tasks").select(TASK_SELECT).eq("household_id", hid).eq("kind", "maintenance").is("completed_at", null);
    let doneQ = ctx.db.from("tasks").select(TASK_SELECT).eq("household_id", hid).eq("kind", "maintenance").not("completed_at", "is", null);
    let histQ = ctx.db.from("maintenance_records").select(RECORD_SELECT).eq("household_id", hid);
    if (input.applianceId) {
      openQ = openQ.eq("appliance_id", input.applianceId);
      doneQ = doneQ.eq("appliance_id", input.applianceId);
      histQ = histQ.eq("appliance_id", input.applianceId);
    }
    const [open, done, history, appliances] = await Promise.all([
      openQ.order("due_on", { ascending: true, nullsFirst: false }).order("priority", { ascending: false }).limit(500),
      input.completedLimit > 0
        ? doneQ.order("completed_at", { ascending: false }).limit(input.completedLimit)
        : Promise.resolve({ data: [] as MaintenanceTaskRow[], error: null }),
      histQ.order("done_on", { ascending: false }).order("created_at", { ascending: false }).limit(input.historyLimit),
      loadAppliances(ctx),
    ]);
    const names = new Map(appliances.map((a) => [a.id, a.name]));
    const t = today(ctx);
    const taskDto = (r: MaintenanceTaskRow) => ({
      id: r.id,
      title: r.title,
      notes: r.notes,
      dueOn: r.due_on,
      daysUntil: r.due_on ? diffDays(t, r.due_on) : null,
      overdue: !r.completed_at && !!r.due_on && r.due_on < t,
      assignee: r.assignee ? { userId: r.assignee, name: memberName(ctx, r.assignee) } : null,
      priority: r.priority,
      frequency: r.frequency,
      appliance: r.appliance_id ? { id: r.appliance_id, name: names.get(r.appliance_id) ?? "Appareil" } : null,
      completedAt: r.completed_at,
      completedBy: r.completed_by ? { userId: r.completed_by, name: memberName(ctx, r.completed_by) } : null,
    });
    const records = (unwrap(history) as MaintenanceRecordRow[]).map((r) => toRecordDto(ctx, r, names));
    const spent = records.reduce((s, r) => s + (r.costCents ?? 0), 0);
    return {
      tasks: [...(unwrap(open) as MaintenanceTaskRow[]), ...(unwrap(done) as MaintenanceTaskRow[])].map(taskDto),
      openCount: (unwrap(open) as MaintenanceTaskRow[]).length,
      history: records,
      historyCostCents: spent,
      historyCost: formatMoney(spent),
    };
  },
});

export const addMaintenanceRecord = defineOp({
  name: "condo.addMaintenanceRecord",
  kind: "write",
  input: z.object({
    title: z.string().trim().min(1, "Décris l'entretien fait.").max(160),
    doneOn: zDay.optional(),
    applianceId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    cost: zMoney.optional(),
    /** Link an existing expense (never creates one). */
    expenseId: z.string().uuid().optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  run: async (ctx, input) => {
    const hid = ctx.household.id;
    const [appliance] = await Promise.all([
      input.applianceId ? assertAppliance(ctx, input.applianceId) : Promise.resolve(null),
      input.taskId
        ? ctx.db
            .from("tasks")
            .select("id")
            .eq("household_id", hid)
            .eq("id", input.taskId)
            .maybeSingle()
            .then((r) => {
              if (!unwrap(r)) throw new AppError("NOT_FOUND", "Tâche introuvable.");
            })
        : Promise.resolve(),
      input.expenseId
        ? ctx.db
            .from("expenses")
            .select("id")
            .eq("household_id", hid)
            .eq("id", input.expenseId)
            .maybeSingle()
            .then((r) => {
              if (!unwrap(r)) throw new AppError("NOT_FOUND", "Dépense introuvable.");
            })
        : Promise.resolve(),
    ]);
    const row = unwrap(
      await ctx.db
        .from("maintenance_records")
        .insert({
          household_id: hid,
          title: input.title,
          done_on: input.doneOn ?? today(ctx),
          appliance_id: input.applianceId ?? null,
          task_id: input.taskId ?? null,
          cost_cents: input.cost !== undefined ? moneyToCents(input.cost) : null,
          expense_id: input.expenseId ?? null,
          notes: input.notes ?? null,
        })
        .select(RECORD_SELECT)
        .single(),
    ) as MaintenanceRecordRow;
    const names = new Map(appliance ? [[appliance.id, appliance.name]] : []);
    return { record: toRecordDto(ctx, row, names) };
  },
});

// ---------------------------------------------------------------------------
// Special assessments (cotisations spéciales)
// ---------------------------------------------------------------------------

export const listSpecialAssessments = defineOp({
  name: "condo.listSpecialAssessments",
  kind: "read",
  input: z.object({}),
  run: async (ctx) => assessmentsSummary(ctx, await loadAssessments(ctx)),
});

export const upsertSpecialAssessment = defineOp({
  name: "condo.upsertSpecialAssessment",
  kind: "write",
  input: z.object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1, "Ajoute un titre.").max(160).optional(),
    amount: zMoney.optional(),
    dueOn: zDay.nullable().optional(),
    paidOn: zDay.nullable().optional(),
    /** Shortcut: mark as paid today. */
    markPaid: z.boolean().optional(),
    notes: zOptText(2000),
  }),
  run: async (ctx, input) => {
    const hid = ctx.household.id;
    if (input.id) {
      const found = unwrap(await ctx.db.from("special_assessments").select("id").eq("household_id", hid).eq("id", input.id).maybeSingle());
      if (!found) throw new AppError("NOT_FOUND", "Cotisation spéciale introuvable.");
    } else if (!input.title || !input.amount) {
      throw new AppError("VALIDATION", "Une cotisation spéciale a besoin d'un titre et d'un montant.");
    }
    const row: Record<string, unknown> = {};
    put(row, "title", input.title);
    put(row, "amount_cents", input.amount, (v) => {
      const c = moneyToCents(v);
      if (c <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
      return c;
    });
    put(row, "due_on", input.dueOn);
    put(row, "paid_on", input.paidOn);
    if (input.markPaid && input.paidOn === undefined) row.paid_on = today(ctx);
    if (input.markPaid === false && input.paidOn === undefined) row.paid_on = null;
    put(row, "notes", input.notes);
    const SEL = "id, title, amount_cents, due_on, paid_on, notes, created_at";
    const saved = (
      input.id
        ? unwrap(await ctx.db.from("special_assessments").update(row).eq("household_id", hid).eq("id", input.id).select(SEL).single())
        : unwrap(await ctx.db.from("special_assessments").insert({ ...row, household_id: hid }).select(SEL).single())
    ) as AssessmentRow;
    return { assessment: toAssessmentDto(ctx, saved), created: !input.id };
  },
});

// ---------------------------------------------------------------------------
// Capital contributions (registre des apports)
// ---------------------------------------------------------------------------

type CapitalRow = {
  id: string;
  user_id: string;
  kind: CapitalKind;
  source: CapitalSource | null;
  amount_cents: number;
  contributed_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
};
const CAPITAL_SELECT = "id, user_id, kind, source, amount_cents, contributed_on, note, created_by, created_at";

async function loadCapital(ctx: HouseholdCtx, userId?: string): Promise<CapitalRow[]> {
  return selectAll<CapitalRow>((from, to) => {
    let q = ctx.db.from("capital_contributions").select(CAPITAL_SELECT).eq("household_id", ctx.household.id);
    if (userId) q = q.eq("user_id", userId);
    return q.order("contributed_on", { ascending: true }).order("created_at", { ascending: true }).range(from, to);
  });
}

function toCapitalDto(ctx: HouseholdCtx, r: CapitalRow) {
  return {
    id: r.id,
    member: { userId: r.user_id, name: memberName(ctx, r.user_id) },
    kind: r.kind,
    kindLabel: CAPITAL_KIND_LABELS_FR[r.kind] ?? r.kind,
    source: r.source,
    sourceLabel: r.source ? (CAPITAL_SOURCE_LABELS_FR[r.source] ?? r.source) : NO_SOURCE_LABEL,
    amountCents: Number(r.amount_cents),
    amount: formatMoney(Number(r.amount_cents)),
    contributedOn: r.contributed_on,
    note: r.note,
    createdAt: r.created_at,
  };
}

function groupTotals<K extends string>(rows: CapitalRow[], key: (r: CapitalRow) => K, label: (k: K) => string) {
  const m = new Map<K, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.amount_cents));
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, cents]) => ({ key: k, label: label(k), totalCents: cents, total: formatMoney(cents) }));
}

export const listCapitalContributions = defineOp({
  name: "condo.listCapitalContributions",
  kind: "read",
  input: z.object({ member: z.string().max(100).optional() }),
  run: async (ctx, input) => {
    const userId = input.member ? resolveMember(ctx, input.member) : undefined;
    const [rows, property] = await Promise.all([loadCapital(ctx, userId), loadProperty(ctx)]);
    const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
    const members = ctx.household.members
      .filter((m) => !userId || m.userId === userId)
      .map((m) => {
        const mine = rows.filter((r) => r.user_id === m.userId);
        const t = mine.reduce((s, r) => s + Number(r.amount_cents), 0);
        return {
          userId: m.userId,
          name: m.displayName,
          isMe: m.userId === ctx.userId,
          totalCents: t,
          total: formatMoney(t),
          byKind: groupTotals(mine, (r) => r.kind, (k) => CAPITAL_KIND_LABELS_FR[k] ?? k),
          bySource: groupTotals(mine, (r) => r.source ?? "none", (k) => (k === "none" ? NO_SOURCE_LABEL : (CAPITAL_SOURCE_LABELS_FR[k as CapitalSource] ?? k))),
        };
      });
    return {
      note: CAPITAL_NOTE,
      totalCents: total,
      total: formatMoney(total),
      members,
      contributions: [...rows].reverse().map((r) => toCapitalDto(ctx, r)),
      ownershipShares: ownershipSharesDto(ctx, property?.ownership_shares ?? null),
      kinds: CAPITAL_KINDS.map((k) => ({ value: k, label: CAPITAL_KIND_LABELS_FR[k] })),
      sources: CAPITAL_SOURCES.map((s) => ({ value: s, label: CAPITAL_SOURCE_LABELS_FR[s] })),
    };
  },
});

export const addCapitalContribution = defineOp({
  name: "condo.addCapitalContribution",
  kind: "write",
  input: z.object({
    member: z.string().max(100).default("moi"),
    kind: z.enum(CAPITAL_KINDS),
    source: z.enum(CAPITAL_SOURCES).nullable().optional(),
    amount: zMoney,
    contributedOn: zDay.optional(),
    note: z.string().trim().max(500).optional(),
    idempotencyKey: zIdempotencyKey.optional(),
  }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "condo.addCapitalContribution", input, async () => {
      const amountCents = moneyToCents(input.amount);
      if (amountCents <= 0) throw new AppError("VALIDATION", "Le montant doit être plus grand que zéro.");
      const row = unwrap(
        await ctx.db
          .from("capital_contributions")
          .insert({
            household_id: ctx.household.id,
            user_id: resolveMember(ctx, input.member),
            kind: input.kind,
            source: input.source ?? null,
            amount_cents: amountCents,
            contributed_on: input.contributedOn ?? today(ctx),
            note: input.note ?? null,
          })
          .select(CAPITAL_SELECT)
          .single(),
      ) as CapitalRow;
      return { contribution: toCapitalDto(ctx, row), note: CAPITAL_NOTE };
    }),
});

export const deleteCapitalContribution = defineOp({
  name: "condo.deleteCapitalContribution",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const row = unwrap(
      await ctx.db
        .from("capital_contributions")
        .delete()
        .eq("household_id", ctx.household.id)
        .eq("id", input.id)
        .select(CAPITAL_SELECT)
        .maybeSingle(),
    ) as CapitalRow | null;
    if (!row) throw new AppError("NOT_FOUND", "Apport introuvable.");
    return { deleted: toCapitalDto(ctx, row) };
  },
});

function csvCell(v: string): string {
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "1234.56" → "1234,56" (no grouping, so Excel fr-CA reads it as a number). */
const csvAmount = (cents: number) => centsToDecimal(cents).replace(".", ",");

export const capitalContributionsCsv = defineOp({
  name: "condo.capitalContributionsCsv",
  kind: "read",
  input: z.object({ member: z.string().max(100).optional() }),
  run: async (ctx, input) => {
    const userId = input.member ? resolveMember(ctx, input.member) : undefined;
    const rows = await loadCapital(ctx, userId);
    const lines = [["date", "partenaire", "type", "source", "montant", "note"]];
    for (const r of rows) {
      lines.push([
        r.contributed_on,
        memberName(ctx, r.user_id),
        CAPITAL_KIND_LABELS_FR[r.kind] ?? r.kind,
        r.source ? (CAPITAL_SOURCE_LABELS_FR[r.source] ?? r.source) : "",
        csvAmount(Number(r.amount_cents)),
        r.note ?? "",
      ]);
    }
    const csv = lines.map((l) => l.map(csvCell).join(";")).join("\r\n") + "\r\n";
    const who = userId ? normalizeKey(memberName(ctx, userId)).replace(/\s+/g, "-") || "membre" : "tous";
    return { filename: `apports-capital-${who}-${today(ctx)}.csv`, mimeType: "text/csv; charset=utf-8", csv, rowCount: rows.length };
  },
});
