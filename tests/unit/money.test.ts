import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DomainError,
  MAX_PARSED_CENTS,
  assertCents,
  centsToDecimal,
  divRoundHalfUp,
  formatMoney,
  formatMoneyCompact,
  parseMoney,
} from "../../src/domain";

const NBSP = " ";
const NNBSP = " ";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe("parseMoney", () => {
  it.each([
    ["85", 8500],
    ["0", 0],
    ["85,5", 8550],
    ["85,50", 8550],
    ["85.50", 8550],
    ["85.5", 8550],
    ["0,05", 5],
    ["1 234,56", 123456],
    [`1${NBSP}234,56`, 123456],
    [`1${NNBSP}234,56`, 123456],
    [`1${NBSP}234,56${NBSP}$`, 123456],
    ["1,234.56", 123456],
    ["1.234,56", 123456],
    ["1,234,567.89", 123456789],
    ["1.234.567,89", 123456789],
    ["1,234,567", 123456700],
    ["1.234.567", 123456700],
    ["1 234 567", 123456700],
    ["1 234", 123400],
    ["85 $", 8500],
    ["$85", 8500],
    ["$ 85", 8500],
    ["85$", 8500],
    ["  85 ", 8500],
    ["0085", 8500],
    ["10000000000", MAX_PARSED_CENTS],
    ["10 000 000 000,00", MAX_PARSED_CENTS],
  ])("%j → %i", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["-5", "SIGN"],
    ["−5", "SIGN"],
    ["+5", "SIGN"],
    ["85,505", "AMBIGUOUS_SEPARATOR"],
    ["85.5055", "TOO_MANY_DECIMALS"],
    ["1,234.567", "TOO_MANY_DECIMALS"],
    ["1,234", "AMBIGUOUS_SEPARATOR"],
    ["1.234", "AMBIGUOUS_SEPARATOR"],
    ["abc", "GARBAGE"],
    ["12a", "GARBAGE"],
    ["$", "GARBAGE"],
    ["85,", "GARBAGE"],
    [",50", "GARBAGE"],
    ["$85$", "CURRENCY_SYMBOL"],
    ["8$5", "CURRENCY_SYMBOL"],
    ["12 34", "GROUPING"],
    ["1,23,456", "GROUPING"],
    ["1.234.56,78", "GROUPING"],
    ["1,2,3.4.5", "SEPARATORS"],
    ["1 234,567.89", "SEPARATORS"],
    ["10000000000,01", "TOO_LARGE"],
    ["99999999999999999999", "TOO_LARGE"],
    ["1e5", "GARBAGE"],
    ["Infinity", "GARBAGE"],
  ])("rejects %j (%s)", (input, reason) => {
    try {
      parseMoney(input);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_AMOUNT");
      expect((e as { details: { reason: string } }).details.reason).toBe(reason);
    }
  });

  it("round-trips formatMoney for random non-negative cents", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_PARSED_CENTS }), (c) => {
        expect(parseMoney(formatMoney(c))).toBe(c);
      }),
      { numRuns: 2000 },
    );
  });

  it("round-trips centsToDecimal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_PARSED_CENTS }), (c) => {
        expect(parseMoney(centsToDecimal(c))).toBe(c);
      }),
    );
  });

  it("parses fr-CA style typed with any space type", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999_999_999 }),
        fc.constantFrom(" ", NBSP, NNBSP),
        (c, sp) => {
          const [w, f] = centsToDecimal(c).split(".");
          const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, sp);
          expect(parseMoney(`${grouped},${f}`)).toBe(c);
          expect(parseMoney(`${grouped},${f}${sp}$`)).toBe(c);
          const en = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          expect(parseMoney(`$${en}.${f}`)).toBe(c);
        },
      ),
    );
  });

  it("never throws anything but DomainError on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (s) => {
        try {
          const c = parseMoney(s);
          expect(Number.isSafeInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(MAX_PARSED_CENTS);
        } catch (e) {
          expect(e).toBeInstanceOf(DomainError);
        }
      }),
      { numRuns: 3000 },
    );
  });
});

describe("formatMoney", () => {
  it("formats fr-CA CAD", () => {
    expect(formatMoney(123456)).toBe(`1${NBSP}234,56${NBSP}$`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}$`);
    expect(formatMoney(5)).toBe(`0,05${NBSP}$`);
    expect(formatMoney(-500)).toBe(`-5,00${NBSP}$`);
    expect(formatMoney(500, { signDisplay: "always" })).toBe(`+5,00${NBSP}$`);
    expect(formatMoney(0, { signDisplay: "exceptZero" })).toBe(`0,00${NBSP}$`);
    expect(formatMoney(-500, { signDisplay: "never" })).toBe(`5,00${NBSP}$`);
  });

  it("is exact for huge safe integers (no float rounding)", () => {
    const s = formatMoney(Number.MAX_SAFE_INTEGER).replace(/\s/g, " ");
    expect(s).toBe("90 071 992 547 409,91 $");
  });

  it("compact", () => {
    expect(formatMoneyCompact(123456).replace(/\s/g, " ")).toMatch(/^1,2 k ?\$$/);
  });

  it("rejects non-integers", () => {
    expect(code(() => formatMoney(1.5))).toBe("INVALID_AMOUNT");
    expect(code(() => assertCents(Number.NaN))).toBe("INVALID_AMOUNT");
    expect(assertCents(42)).toBe(42);
  });
});

describe("centsToDecimal / divRoundHalfUp", () => {
  it("formats", () => {
    expect(centsToDecimal(123456)).toBe("1234.56");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(0)).toBe("0.00");
  });
  it("rounds half up", () => {
    expect(divRoundHalfUp(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(divRoundHalfUp(BigInt(4), BigInt(3))).toBe(BigInt(1));
    expect(divRoundHalfUp(BigInt(-5), BigInt(2))).toBe(BigInt(-3));
  });
});
