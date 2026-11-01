import { DomainError } from "./errors";

/** Montant en cents (entier sûr). 1 $ = 100. */
export type Cents = number;

/** Plafond accepté par `parseMoney` : 10 milliards de dollars. */
export const MAX_PARSED_CENTS: Cents = 1_000_000_000_000;

export function assertCents(n: number, label = "montant"): Cents {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `Le ${label} doit être un nombre entier de cents.`,
      { label, value: n },
    );
  }
  return n;
}

/** Comme `assertCents`, mais refuse aussi les montants négatifs. */
export function assertNonNegativeCents(n: number, label = "montant"): Cents {
  assertCents(n, label);
  if (n < 0) {
    throw new DomainError("INVALID_AMOUNT", `Le ${label} ne peut pas être négatif.`, {
      label,
      value: n,
    });
  }
  return n;
}

function invalidAmount(input: string, reason: string): DomainError {
  return new DomainError(
    "INVALID_AMOUNT",
    "Montant invalide. Écris par exemple 85, 85,50 ou 1 234,56.",
    { input, reason },
  );
}

const SPACE_LIKE = /[\s    ]+/g;

/**
 * Convertit une saisie (humaine ou MCP) en cents, sans jamais passer par un float.
 *
 * Normalisation : espaces (y compris NBSP U+00A0, espace fine insécable U+202F,
 * U+2007, U+2009) unifiés; un seul symbole `$` permis, au début ou à la fin
 * ("$85", "85$", "85 $"). Signe `-`/`−`/`+` → refusé.
 *
 * Heuristique des séparateurs `,` et `.` :
 *  1. Les deux sortes présentes ("1,234.56", "1.234,56") : la plus à droite est le
 *     séparateur décimal (une seule occurrence, suivie de 1–2 chiffres); l'autre est
 *     le séparateur de milliers (n'apparaît qu'à gauche).
 *  2. Une seule sorte, une seule occurrence :
 *     - suivie de 1 ou 2 chiffres en fin de chaîne → décimal ("85,5", "85.50");
 *     - suivie d'exactement 3 chiffres → AMBIGU ("1,234" = 1,234 $ en français
 *       ou 1 234 $ en anglais) → refusé plutôt que de risquer un facteur 1000;
 *     - sinon → refusé.
 *  3. Une seule sorte, plusieurs occurrences ("1,234,567") → milliers, sans décimales.
 *  4. Les espaces ne sont permis que comme séparateurs de milliers dans la partie
 *     entière, et jamais combinés à un autre séparateur de milliers.
 *  Les groupes de milliers doivent être valides : 1–3 chiffres puis groupes de 3.
 *  Partie entière obligatoire (",50" refusé), au plus 2 décimales.
 */
export function parseMoney(input: string): Cents {
  if (typeof input !== "string") throw invalidAmount(String(input), "NOT_A_STRING");
  let s = input.replace(SPACE_LIKE, " ").trim();
  if (s === "") throw invalidAmount(input, "EMPTY");
  if (/[-−+]/.test(s)) throw invalidAmount(input, "SIGN");

  const dollarCount = (s.match(/\$/g) ?? []).length;
  if (dollarCount > 1) throw invalidAmount(input, "CURRENCY_SYMBOL");
  if (dollarCount === 1) {
    if (s.startsWith("$")) s = s.slice(1).trim();
    else if (s.endsWith("$")) s = s.slice(0, -1).trim();
    else throw invalidAmount(input, "CURRENCY_SYMBOL");
  }
  if (s === "" || !/^[0-9][0-9 .,]*$/.test(s) || !/[0-9]$/.test(s)) {
    throw invalidAmount(input, "GARBAGE");
  }

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let intRaw = s;
  let fracRaw = "";
  let thousandsSep: string | null = null;

  if (commas > 0 && dots > 0) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const dec = lastComma > lastDot ? "," : ".";
    const other = dec === "," ? "." : ",";
    if ((dec === "," ? commas : dots) !== 1) throw invalidAmount(input, "SEPARATORS");
    const idx = s.lastIndexOf(dec);
    intRaw = s.slice(0, idx);
    fracRaw = s.slice(idx + 1);
    if (intRaw.includes(" ")) throw invalidAmount(input, "SEPARATORS");
    thousandsSep = other;
  } else if (commas + dots === 1) {
    const sep = commas === 1 ? "," : ".";
    const idx = s.indexOf(sep);
    const after = s.slice(idx + 1);
    if (/^[0-9]{1,2}$/.test(after)) {
      intRaw = s.slice(0, idx);
      fracRaw = after;
      thousandsSep = intRaw.includes(" ") ? " " : null;
    } else if (/^[0-9]{3}$/.test(after)) {
      throw invalidAmount(input, "AMBIGUOUS_SEPARATOR");
    } else {
      throw invalidAmount(input, "TOO_MANY_DECIMALS");
    }
  } else if (commas + dots > 1) {
    const sep = commas > 0 ? "," : ".";
    if (s.includes(" ")) throw invalidAmount(input, "SEPARATORS");
    thousandsSep = sep;
  } else {
    thousandsSep = s.includes(" ") ? " " : null;
  }

  if (!/^[0-9]{1,2}$/.test(fracRaw) && fracRaw !== "") {
    throw invalidAmount(input, "TOO_MANY_DECIMALS");
  }

  let digits: string;
  if (thousandsSep !== null && intRaw.includes(thousandsSep)) {
    const groups = intRaw.split(thousandsSep);
    if (!/^[0-9]{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^[0-9]{3}$/.test(g))) {
      throw invalidAmount(input, "GROUPING");
    }
    digits = groups.join("");
  } else {
    digits = intRaw;
  }
  if (!/^[0-9]+$/.test(digits)) throw invalidAmount(input, "GARBAGE");

  const trimmed = digits.replace(/^0+(?=[0-9])/, "");
  if (trimmed.length > 12) throw invalidAmount(input, "TOO_LARGE");
  const cents = BigInt(trimmed) * BigInt(100) + BigInt(fracRaw.padEnd(2, "0") || "0");
  if (cents > BigInt(MAX_PARSED_CENTS)) throw invalidAmount(input, "TOO_LARGE");
  return Number(cents);
}

/** "123456" → "1234.56", "-5" → "-0.05". Pour les sorties MCP/CSV. */
export function centsToDecimal(cents: Cents): string {
  assertCents(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${neg ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

export type MoneySignDisplay = "auto" | "always" | "exceptZero" | "never";

const formatters = new Map<string, Intl.NumberFormat>();
function currencyFormatter(signDisplay: MoneySignDisplay, compact: boolean): Intl.NumberFormat {
  const key = `${signDisplay}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: "CAD",
      signDisplay,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

type FormatInput = Parameters<Intl.NumberFormat["format"]>[0];

/**
 * "1 234,56 $" (espaces tels qu'émis par Intl, typiquement U+00A0).
 * Le montant est passé à Intl sous forme de chaîne décimale exacte (pas de float).
 */
export function formatMoney(
  cents: Cents,
  opts: { signDisplay?: MoneySignDisplay } = {},
): string {
  assertCents(cents);
  return currencyFormatter(opts.signDisplay ?? "auto", false).format(
    centsToDecimal(cents) as unknown as FormatInput,
  );
}

/** Format court pour graphiques : "1,2 k $", "3,4 M $". */
export function formatMoneyCompact(cents: Cents): string {
  assertCents(cents);
  return currencyFormatter("auto", true).format(centsToDecimal(cents) as unknown as FormatInput);
}

/** Arrondi demi vers le haut (loin de zéro pour les négatifs) de num/den, en BigInt. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den === BigInt(0)) throw new DomainError("DIVISION_BY_ZERO", "Division par zéro.");
  const neg = num < BigInt(0) !== den < BigInt(0);
  const n = num < BigInt(0) ? -num : num;
  const d = den < BigInt(0) ? -den : den;
  const q = (n * BigInt(2) + d) / (d * BigInt(2));
  return neg ? -q : q;
}
