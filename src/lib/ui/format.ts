/**
 * Tiny UI-side money helpers. The domain layer owns its own formatter; this
 * one exists so UI primitives have no dependency on `src/domain`.
 * Amounts are integer cents, CAD, formatted for fr-CA: `1 234,56 $`.
 */

const moneyFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

const moneySignedFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  signDisplay: "exceptZero",
});

const moneyRoundFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const moneyRoundSignedFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

export type FormatMoneyOptions = {
  /** Show `+` / `−` for non-zero amounts. */
  sign?: boolean;
  /** Drop the cents (`1 234 $`). */
  round?: boolean;
};

export function formatMoney(cents: number, options: FormatMoneyOptions = {}): string {
  const value = cents / 100;
  const formatter = options.round
    ? options.sign
      ? moneyRoundSignedFormatter
      : moneyRoundFormatter
    : options.sign
      ? moneySignedFormatter
      : moneyFormatter;
  const text = formatter.format(value);
  // Typographic minus (U+2212) instead of the hyphen Intl emits.
  return text.replace("-", "\u2212");
}

/** Placeholder shown in privacy mode. Same rough width as a real amount. */
export const MASKED_MONEY = "•••,•• $";

/**
 * Parses what a person types in an amount field ("85,50", "85.5", "1 234,56")
 * into integer cents. Returns `null` when the text is not a valid amount.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[\s  $]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === ".") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Restricts free text to a valid in-progress amount: digits, one decimal
 * separator (shown as a comma, fr-CA), at most two decimals.
 */
export function sanitizeMoneyInput(text: string): string {
  let out = "";
  let seenSeparator = false;
  let decimals = 0;
  for (const char of text) {
    if (char >= "0" && char <= "9") {
      if (seenSeparator) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += char;
    } else if ((char === "," || char === ".") && !seenSeparator) {
      seenSeparator = true;
      out += out === "" ? "0," : ",";
    }
  }
  // No leading zeros like "007" (but keep "0,5").
  return out.replace(/^0+(?=\d)/, "");
}

/** Formats cents for an editable field: 8550 → "85,50", 8500 → "85". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  return fraction === 0 ? String(whole) : `${whole},${String(fraction).padStart(2, "0")}`;
}
