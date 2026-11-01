import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DomainError, estimatedTotal, lineTotalCents, parseItemLine } from "../../src/domain";

describe("parseItemLine", () => {
  it.each([
    ["2 lait 3,99", { name: "lait", quantity: 2, unitPriceCents: 399 }],
    ["lait", { name: "lait", quantity: 1, unitPriceCents: null }],
    ["  Lait  2 %  ", { name: "Lait 2 %", quantity: 1, unitPriceCents: null }],
    ["rideaux 150$", { name: "rideaux", quantity: 1, unitPriceCents: 15000 }],
    ["rideaux 150 $", { name: "rideaux", quantity: 1, unitPriceCents: 15000 }],
    ["rideaux $150", { name: "rideaux", quantity: 1, unitPriceCents: 15000 }],
    ["rideaux 149.99", { name: "rideaux", quantity: 1, unitPriceCents: 14999 }],
    ["3x yogourt", { name: "yogourt", quantity: 3, unitPriceCents: null }],
    ["3 x yogourt", { name: "yogourt", quantity: 3, unitPriceCents: null }],
    ["x3 yogourt", { name: "yogourt", quantity: 3, unitPriceCents: null }],
    ["yogourt x3", { name: "yogourt", quantity: 3, unitPriceCents: null }],
    ["yogourt ×3 1,25$", { name: "yogourt", quantity: 3, unitPriceCents: 125 }],
    ["1,5 kg farine", { name: "kg farine", quantity: 1.5, unitPriceCents: null }],
    ["0.25 fromage 12,00", { name: "fromage", quantity: 0.25, unitPriceCents: 1200 }],
    ["piles AA 4", { name: "piles AA 4", quantity: 1, unitPriceCents: null }],
    ["2", { name: "2", quantity: 1, unitPriceCents: null }],
    ["3,99", { name: "3,99", quantity: 1, unitPriceCents: null }],
    ["12 oeufs", { name: "oeufs", quantity: 12, unitPriceCents: null }],
    ["999 clous", { name: "clous", quantity: 999, unitPriceCents: null }],
    ["1000 feuilles", { name: "1000 feuilles", quantity: 1, unitPriceCents: null }],
  ])("%j", (line, expected) => {
    expect(parseItemLine(line)).toEqual(expected);
  });

  it("rejects empty", () => {
    for (const l of ["", "   ", " "]) {
      expect(() => parseItemLine(l)).toThrow(expect.objectContaining({ code: "EMPTY_ITEM" }));
    }
  });
  it("rejects zero quantity", () => {
    expect(() => parseItemLine("0 lait")).toThrow(expect.objectContaining({ code: "INVALID_QUANTITY" }));
  });
  it("fuzz: never empty name, quantity in range, only DomainError", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        try {
          const r = parseItemLine(s);
          expect(r.name.length).toBeGreaterThan(0);
          expect(r.quantity).toBeGreaterThan(0);
          expect(r.quantity).toBeLessThanOrEqual(999);
        } catch (e) {
          expect(e).toBeInstanceOf(DomainError);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("estimatedTotal", () => {
  it("sums remaining / purchased / unknown", () => {
    expect(
      estimatedTotal([
        { quantity: 2, unitPriceCents: 399, purchased: false },
        { quantity: 1.5, unitPriceCents: 333, purchased: false }, // 499.5 → 500
        { quantity: 1, unitPriceCents: null, purchased: false },
        { quantity: 1, unitPriceCents: null, purchased: true },
        { quantity: 3, unitPriceCents: 100, purchased: true },
      ]),
    ).toEqual({ remainingCents: 1298, purchasedCents: 300, unknownCount: 1 });
  });
  it("lineTotalCents is exact with 2-decimal quantities", () => {
    expect(lineTotalCents(0.29, 100)).toBe(29); // 0.29 × 100 in float is 28.999…
    expect(lineTotalCents(1.15, 1000)).toBe(1150);
    expect(lineTotalCents(999, 9_000_000_000_000)).toBe(8_991_000_000_000_000);
  });
});
