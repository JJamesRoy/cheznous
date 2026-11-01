import { DomainError } from "./errors";
import { assertCents, divRoundHalfUp, parseMoney, type Cents } from "./money";

export const MAX_QUANTITY = 999;

export interface ParsedItem {
  name: string;
  quantity: number;
  unitPriceCents: Cents | null;
}

/** Nombre ≥ 0 avec au plus 2 décimales (`,` ou `.`), sans séparateur de milliers. */
const QTY_RE = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
/** Prix : « 3,99 », « 150$ », « $150 », « 3.99$ » — doit contenir `$` ou des décimales. */
const PRICE_WITH_DOLLAR_RE = /^(?:\$\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\$)$/;
const PRICE_DECIMAL_RE = /^\d+[.,]\d{2}$/;

function parseQty(tok: string): number | null {
  const m = QTY_RE.exec(tok);
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return hundredths / 100;
}

function invalidQuantity(line: string): DomainError {
  return new DomainError("INVALID_QUANTITY", `La quantité doit être entre 0,01 et ${MAX_QUANTITY}.`, { line });
}

/**
 * Analyse une ligne de liste d'épicerie. Règles, dans l'ordre :
 *  1. Prix en fin de ligne : un jeton « 3,99 », « 150$ », « $150 », ou un nombre
 *     suivi d'un jeton « $ » séparé (« 150 $ »). Un entier nu sans `$` (« piles 4 »)
 *     n'est PAS un prix (il reste dans le nom). Le prix passe par parseMoney.
 *  2. Quantité en fin de ligne : « x3 » / « ×3 » (ou « x 3 »).
 *  3. Quantité en début de ligne : « 3x » / « 3× » / « x3 » / « 3 x », ou un nombre
 *     (entier ou décimal avec , ou .) SEULEMENT s'il est suivi d'autre texte :
 *     « 1,5 kg farine » → quantité 1,5, nom « kg farine »; « 2 » seul → nom « 2 ».
 *  Une seule quantité est retenue (début, sinon fin). Un prix ou une quantité qui
 *  laisserait le nom vide reste dans le nom. Nom vide → EMPTY_ITEM.
 *  Quantité dans ]0, 999], 2 décimales max, sinon INVALID_QUANTITY.
 */
export function parseItemLine(line: string): ParsedItem {
  const toks = line.replace(/[\s  ]+/g, " ").trim().split(" ").filter(Boolean);
  if (toks.length === 0) throw new DomainError("EMPTY_ITEM", "Écris le nom de l'article.", { line });

  let unitPriceCents: Cents | null = null;
  let quantity: number | null = null;

  // 1. Prix en fin de ligne.
  const last = toks[toks.length - 1];
  if (last === "$" && toks.length >= 3 && /^\d+(?:[.,]\d{1,2})?$/.test(toks[toks.length - 2])) {
    unitPriceCents = tryMoney(toks[toks.length - 2]);
    if (unitPriceCents !== null) toks.splice(-2, 2);
  } else if (toks.length >= 2 && (PRICE_WITH_DOLLAR_RE.test(last) || PRICE_DECIMAL_RE.test(last) || /^\d+,\d$/.test(last))) {
    unitPriceCents = tryMoney(last);
    if (unitPriceCents !== null) toks.pop();
  }

  // 2/3. Quantité.
  const first = toks[0];
  let m: RegExpExecArray | null;
  if (toks.length >= 2 && (m = /^(.+?)[x×]$/i.exec(first)) && parseQty(m[1]) !== null) {
    quantity = parseQty(m[1]);
    toks.shift();
  } else if (toks.length >= 2 && (m = /^[x×](.+)$/i.exec(first)) && parseQty(m[1]) !== null) {
    quantity = parseQty(m[1]);
    toks.shift();
  } else if (toks.length >= 3 && parseQty(first) !== null && /^[x×]$/i.test(toks[1])) {
    quantity = parseQty(first);
    toks.splice(0, 2);
  } else if (toks.length >= 2 && parseQty(first) !== null) {
    quantity = parseQty(first);
    toks.shift();
  } else {
    const end = toks[toks.length - 1];
    if (toks.length >= 2 && (m = /^[x×](.+)$/i.exec(end)) && parseQty(m[1]) !== null) {
      quantity = parseQty(m[1]);
      toks.pop();
    } else if (toks.length >= 3 && /^[x×]$/i.test(toks[toks.length - 2]) && parseQty(end) !== null) {
      quantity = parseQty(end);
      toks.splice(-2, 2);
    }
  }

  const name = toks.join(" ").trim();
  if (name === "") throw new DomainError("EMPTY_ITEM", "Écris le nom de l'article.", { line });
  const q = quantity ?? 1;
  if (!(q > 0) || q > MAX_QUANTITY) throw invalidQuantity(line);
  return { name, quantity: q, unitPriceCents };
}

function tryMoney(tok: string): Cents | null {
  try {
    return parseMoney(tok);
  } catch {
    return null;
  }
}

/** Montant d'une ligne : arrondi(prix × quantité), quantité à 2 décimales max, en BigInt. */
export function lineTotalCents(quantity: number, unitPriceCents: Cents): Cents {
  assertCents(unitPriceCents, "prix");
  const qh = Math.round(quantity * 100);
  if (!Number.isSafeInteger(qh) || qh < 0) throw invalidQuantity(String(quantity));
  return Number(divRoundHalfUp(BigInt(unitPriceCents) * BigInt(qh), BigInt(100)));
}

/**
 * Total estimé d'une liste. remaining = articles non achetés avec prix;
 * purchased = articles achetés avec prix; unknownCount = articles NON achetés sans prix.
 */
export function estimatedTotal(items: { quantity: number; unitPriceCents: Cents | null; purchased: boolean }[]): {
  remainingCents: Cents;
  purchasedCents: Cents;
  unknownCount: number;
} {
  let remainingCents = 0;
  let purchasedCents = 0;
  let unknownCount = 0;
  for (const it of items) {
    if (it.unitPriceCents === null) {
      if (!it.purchased) unknownCount++;
      continue;
    }
    const t = lineTotalCents(it.quantity, it.unitPriceCents);
    if (it.purchased) purchasedCents += t;
    else remainingCents += t;
  }
  return { remainingCents, purchasedCents, unknownCount };
}
