/**
 * Splitwise CSV export → Chez Nous expenses and settlements (pure functions, no I/O).
 *
 * Export format (one column per person, value = net effect of the line for that person):
 *   Date,Description,Category,Cost,Currency,<Person A>,<Person B>
 *   2026-09-23,Inspecteur,General,517.00,CAD,-258.50,258.50
 *   2026-11-01,Total balance, , ,CAD,-255.06,255.06
 * Positive = paid more than their share; negative = owes that amount.
 */
import { createHash } from "node:crypto";

export type Cents = number;

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "−258.50" / "258.5" / "1425" → cents, without floating point. */
export function toCents(raw: string): Cents {
  const s = raw.trim().replace(/−/g, "-");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Montant illisible : « ${raw} »`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

export const fmtCents = (c: Cents) => (c / 100).toFixed(2);

/** Lowercase, no accents, single spaces, common typos fixed. */
export function normalizeDescription(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, to] of TYPOS) t = t.replace(re, to);
  return t;
}

const TYPOS: [RegExp, string][] = [
  [/\bcostoc\b/g, "costco"],
  [/\bcpstco\b/g, "costco"],
  [/\bepicierie\b/g, "epicerie"],
  [/\bintermet\b/g, "internet"],
  [/\bsouoer\b/g, "souper"],
];

export type CategoryRule = { name: string; category: string; test: (desc: string, splitwiseCategory: string) => boolean };

const rx = (re: RegExp) => (d: string) => re.test(d);

/** First match wins. Mirrors the import spec, with word boundaries on short tokens. */
export const CATEGORY_RULES: CategoryRule[] = [
  { name: "splitwise:Dining out", category: "Resto", test: (_d, c) => c === "Dining out" },
  { name: "desc:uber eats", category: "Resto", test: rx(/\buber ?eats\b|\bubereats\b|\bdoordash\b/) },
  { name: "desc:frais condo", category: "Frais de condo", test: rx(/frais cond/) },
  { name: "desc:assurance habitation", category: "Assurance habitation", test: rx(/assurance habitation/) },
  { name: "desc:electromenagers", category: "Meubles et déco", test: rx(/\belectro\b/) },
  { name: "splitwise:Bus/train (metro)", category: "Transport (STM, BIXI, auto)", test: (d, c) => c === "Bus/train" || (c === "Car" && /assurance/.test(d)) },
  {
    name: "desc:epicerie",
    category: "Épicerie",
    test: rx(/maxi|epicer|epicier|costco|fruiterie|\biga\b|\bsuper ?c\b|\bmetro\b|\bmrtro\b|marche|fromage|boulangerie|\bpain\b|walmart/),
  },
  {
    name: "desc:resto",
    category: "Resto",
    test: rx(/resto|mcdo|sushi|subway|sandwich|souper|tacos|shawarma|poutine|burger|bagel|ramen|pizza|\bcafe\b|dejeuner|piklik|piklis|matcha/),
  },
  { name: "desc:saq", category: "SAQ", test: rx(/\bsaq\b/) },
  { name: "desc:depanneur", category: "Dépanneur", test: rx(/depanneur/) },
  { name: "desc:hydro", category: "Électricité (Hydro-Québec)", test: rx(/hydro|electricite|electrical/) },
  { name: "desc:internet", category: "Internet et cellulaire", test: rx(/internet/) },
  {
    name: "desc:transport",
    category: "Transport (STM, BIXI, auto)",
    test: rx(/\bgaz\b|\bgas\b|essence|\besso\b|\bstm\b|\bbus\b|\buber\b|taxi|\bvia\b|immatriculation|pneu|garage|lave auto|\bchar\b|uhaul|assurances? auto/),
  },
  { name: "desc:meubles", category: "Meubles et déco", test: rx(/ikea|\btable\b|\bbureau\b|meuble/) },
  { name: "desc:entretien", category: "Entretien et réparations", test: rx(/\brona\b|canadian tire/) },
  { name: "desc:sante", category: "Santé et pharmacie", test: rx(/pharma|pillule|podiatre|vaccin|\bosm\b/) },
  {
    name: "desc:voyages",
    category: "Voyages",
    test: (d, c) => c === "Plane" || c === "Hotel" || /avion|\bvol\b|hotel|airbnb|camping|cruise|refuge/.test(d),
  },
  { name: "splitwise:Groceries", category: "Épicerie", test: (_d, c) => c === "Groceries" },
  { name: "splitwise:Electricity", category: "Électricité (Hydro-Québec)", test: (_d, c) => c === "Electricity" },
  { name: "splitwise:TV/Phone/Internet", category: "Internet et cellulaire", test: (_d, c) => c === "TV/Phone/Internet" },
  { name: "splitwise:Furniture", category: "Meubles et déco", test: (_d, c) => c === "Furniture" },
  { name: "splitwise:Car/Taxi/Gas", category: "Transport (STM, BIXI, auto)", test: (_d, c) => ["Car", "Taxi", "Gas/fuel"].includes(c) },
];

export function categorize(description: string, splitwiseCategory: string): { category: string; rule: string } {
  const d = normalizeDescription(description);
  const c = splitwiseCategory.trim();
  for (const r of CATEGORY_RULES) if (r.test(d, c)) return { category: r.category, rule: r.name };
  return { category: "Divers", rule: "default" };
}

/** Lines the spec asks to flag for a human (not condo-related, category guessed). */
export const FLAG_PATTERNS: [RegExp, string][] = [
  [/assurance job/, "Assurance job : catégorie Divers par défaut"],
  [/assurances? auto/, "Assurance auto : catégorie Transport (meilleure catégorie existante)"],
];

export type Override = {
  group: string;
  date: string;
  description: string;
  asSettlement?: boolean;
  category?: string;
  project?: string;
  note?: string;
  recurringTitle?: string;
  recurringOccurrence?: string;
};

export type SplitwiseLine = {
  group: string;
  lineNo: number;
  raw: string;
  /** Stable key: import:splitwise:<group>:<sha1(line)[#n]> */
  key: string;
  date: string;
  description: string;
  splitwiseCategory: string;
  costCents: Cents;
  /** Person column header → net cents. */
  values: Record<string, Cents>;
};

export type Planned =
  | {
      kind: "expense";
      line: SplitwiseLine;
      payer: string;
      shares: Record<string, Cents>;
      category: string;
      rule: string;
      project: string | null;
      note: string | null;
      recurringTitle: string | null;
      recurringOccurrence: string | null;
      flags: string[];
    }
  | { kind: "settlement"; line: SplitwiseLine; from: string; to: string; amountCents: Cents; note: string | null; rule: string; flags: string[] }
  | { kind: "skip"; line: SplitwiseLine; reason: string };

export type ParsedGroup = { group: string; people: string[]; lines: SplitwiseLine[]; totals: Record<string, Cents> | null };

export function parseSplitwiseExport(group: string, text: string): ParsedGroup {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header || header[0] !== "Date" || header[3] !== "Cost") throw new Error(`${group} : en-tête Splitwise inattendu.`);
  const people = header.slice(5).map((p) => p.trim());
  const lines: SplitwiseLine[] = [];
  const seen = new Map<string, number>();
  let totals: Record<string, Cents> | null = null;
  const rawLines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((f) => f.trim() === "")) continue;
    const description = (r[1] ?? "").trim();
    const values = Object.fromEntries(people.map((p, j) => [p, toCents(r[5 + j] ?? "0")]));
    if (description === "Total balance") {
      totals = values;
      continue;
    }
    const raw = rawLines[i] ?? r.join(",");
    const h = createHash("sha1").update(r.join("\u001f")).digest("hex");
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    lines.push({
      group,
      lineNo: i + 1,
      raw,
      key: `import:splitwise:${group}:${h}${n > 1 ? `#${n}` : ""}`,
      date: r[0].trim(),
      description,
      splitwiseCategory: (r[2] ?? "").trim(),
      costCents: toCents(r[3]),
      values,
    });
  }
  return { group, people, lines, totals };
}

/** "Lorane B." / "Lorane Brière" / "James" → the person column it refers to (by first name). */
export function personFor(people: string[], label: string): string | null {
  const first = (s: string) => normalizeDescription(s).split(" ")[0];
  const hit = people.filter((p) => first(p) === first(label));
  return hit.length === 1 ? hit[0] : null;
}

export function planLine(people: string[], line: SplitwiseLine, overrides: Override[]): Planned {
  const ov = overrides.find((o) => o.group === line.group && o.date === line.date && o.description === line.description) ?? null;
  const vals = people.map((p) => [p, line.values[p]] as const);
  if (people.length !== 2) return { kind: "skip", line, reason: "Groupe à plus de deux personnes : non géré." };
  if (line.costCents <= 0) return { kind: "skip", line, reason: "Montant nul ou négatif." };
  if (vals.every(([, v]) => v === 0)) return { kind: "skip", line, reason: "Valeurs à 0 pour les deux personnes." };
  if (vals.some(([, v]) => Math.abs(v) > line.costCents)) return { kind: "skip", line, reason: "Une valeur dépasse le montant total." };
  if (vals[0][1] + vals[1][1] !== 0) return { kind: "skip", line, reason: "Les valeurs ne s'annulent pas (somme ≠ 0)." };

  const [pos] = vals.filter(([, v]) => v > 0);
  const [neg] = vals.filter(([, v]) => v < 0);

  if (line.splitwiseCategory === "Payment") {
    const m = /^(.+?) paid (.+)$/.exec(line.description);
    const from = m ? personFor(people, m[1]) : null;
    const to = m ? personFor(people, m[2]) : null;
    if (!from || !to || from === to) return { kind: "skip", line, reason: `Paiement illisible : « ${line.description} ».` };
    // Sanity: the payer of a settlement ends up positive in Splitwise's columns.
    if (line.values[from] !== line.costCents) return { kind: "skip", line, reason: "Paiement incohérent avec les colonnes." };
    return { kind: "settlement", line, from, to, amountCents: line.costCents, note: null, rule: "splitwise:Payment", flags: [] };
  }

  if (ov?.asSettlement) {
    // A loan: whoever is positive gave money to the other.
    return {
      kind: "settlement",
      line,
      from: pos[0],
      to: neg[0],
      amountCents: pos[1],
      note: ov.note ?? null,
      rule: "override:prêt",
      flags: [],
    };
  }

  const payer = pos[0];
  const other = neg[0];
  const shares: Record<string, Cents> = { [other]: -neg[1] };
  const payerShare = line.costCents - pos[1];
  if (payerShare > 0) shares[payer] = payerShare;
  const sum = Object.values(shares).reduce((s, v) => s + v, 0);
  if (sum !== line.costCents) return { kind: "skip", line, reason: "Parts ≠ montant (contrôle au cent)." };

  const auto = categorize(line.description, line.splitwiseCategory);
  const d = normalizeDescription(line.description);
  const flags = FLAG_PATTERNS.filter(([re]) => re.test(d)).map(([, msg]) => msg);
  return {
    kind: "expense",
    line,
    payer,
    shares,
    category: ov?.category ?? auto.category,
    rule: ov?.category ? "override" : auto.rule,
    project: ov?.project ?? null,
    note: ov?.note ?? null,
    recurringTitle: ov?.recurringTitle ?? null,
    recurringOccurrence: ov?.recurringOccurrence ?? null,
    flags,
  };
}

/** Net per person of a set of lines (Splitwise semantics: sum of the person's column). */
export function netOf(people: string[], lines: SplitwiseLine[]): Record<string, Cents> {
  const out = Object.fromEntries(people.map((p) => [p, 0]));
  for (const l of lines) for (const p of people) out[p] += l.values[p];
  return out;
}
