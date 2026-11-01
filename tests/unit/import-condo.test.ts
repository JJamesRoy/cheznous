import { describe, expect, it } from "vitest";
import { amortizationSchedule, computePayment, periodicRate } from "../../src/domain";
import { categorize, netOf, parseCsv, parseSplitwiseExport, planLine, toCents } from "../../scripts/lib/splitwise";

describe("import condo — CIBC mortgage (4,09 % fixed, semi-annual, 30 years)", () => {
  const principal = 45_927_180; // 459 271,80 $ incl. 14 671,80 $ loan insurance premium
  const r = Math.pow(1 + 0.0409 / 2, 1 / 6) - 1;

  it("periodic rate is (1 + 0.0409/2)^(1/6) − 1", () => {
    expect(periodicRate(4.09, 12, "semiannual")).toBeCloseTo(r, 15);
  });

  it("recomputes the 2 207,38 $ payment exactly", () => {
    expect(computePayment({ principalCents: principal, annualRatePct: 4.09, amortizationMonths: 360, frequency: "monthly", compounding: "semiannual" })).toBe(220_738);
  });

  it("balance after the first payment (2026-11-30) is ≈ 458 616 $", () => {
    const [first] = amortizationSchedule({
      balanceCents: principal,
      annualRatePct: 4.09,
      paymentCents: 220_738,
      frequency: "monthly",
      compounding: "semiannual",
      startDate: "2026-11-30",
    });
    expect(first.date).toBe("2026-11-30");
    const byHand = Math.round(principal * (1 + r) - 220_738);
    expect(Math.abs(first.balanceCents - byHand)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.balanceCents - 45_861_600)).toBeLessThan(100); // within 1 $
  });
});

describe("import condo — Splitwise conversion", () => {
  const csv = [
    "Date,Description,Category,Cost,Currency,Alex Tremblay,Sam",
    "",
    "2026-09-23,Inspecteur,General,517.00,CAD,-258.50,258.50",
    '2026-02-26,"Camping (accès, bouffe, camping)",Entertainment - Other,163.00,CAD,-163.00,163.00',
    "2024-07-02,Maxi,General,100.00,CAD,-40.00,40.00",
    "2026-10-30,Souper,General,165.00,CAD,-66.00,66.00",
    "2024-06-11,Épicerie ,General,56.00,CAD,-22.40,22.40",
    "2024-07-28,Alex T. paid Sam,Payment,200.00,CAD,200.00,-200.00",
    "2026-01-25,Sam paid Alex T.,Payment,300.00,CAD,-300.00,300.00",
    "2024-06-11,Uniqlo,General,126.13,CAD,126.13,-126.13",
    "2024-01-01,Bizarre,General,10.00,CAD,0.00,0.00",
    "",
    "2026-11-01,Total balance, , ,CAD,-523.77,523.77",
    "",
  ].join("\n");
  const g = parseSplitwiseExport("test", csv);
  const people = g.people;

  it("parses quoted descriptions with commas and strips spaces", () => {
    expect(parseCsv('a,"b, c",d\n')[0]).toEqual(["a", "b, c", "d"]);
    expect(g.lines.map((l) => l.description)).toContain("Camping (accès, bouffe, camping)");
    expect(g.lines.map((l) => l.description)).toContain("Épicerie");
    expect(toCents("-258.50")).toBe(-25_850);
    expect(toCents("1425")).toBe(142_500);
  });

  it("ignores blank lines and the Total balance line, and the lines sum to it", () => {
    expect(g.lines).toHaveLength(9);
    expect(netOf(people, g.lines)).toEqual(g.totals);
  });

  it("keeps the historical split (exact) instead of re-applying the household split", () => {
    const maxi = planLine(people, g.lines.find((l) => l.description === "Maxi")!, []);
    expect(maxi).toMatchObject({ kind: "expense", payer: "Sam", shares: { "Alex Tremblay": 4000, Sam: 6000 }, category: "Épicerie" });
    const souper = planLine(people, g.lines.find((l) => l.description === "Souper")!, []);
    expect(souper).toMatchObject({ kind: "expense", shares: { "Alex Tremblay": 6600, Sam: 9900 }, category: "Resto" });
    const uniqlo = planLine(people, g.lines.find((l) => l.description === "Uniqlo")!, []);
    expect(uniqlo).toMatchObject({ kind: "expense", payer: "Alex Tremblay", shares: { Sam: 12_613 } });
  });

  it("turns Payment lines into settlements in both directions", () => {
    const a = planLine(people, g.lines.find((l) => l.description === "Alex T. paid Sam")!, []);
    expect(a).toMatchObject({ kind: "settlement", from: "Alex Tremblay", to: "Sam", amountCents: 20_000 });
    const b = planLine(people, g.lines.find((l) => l.description === "Sam paid Alex T.")!, []);
    expect(b).toMatchObject({ kind: "settlement", from: "Sam", to: "Alex Tremblay", amountCents: 30_000 });
  });

  it("imports a loan override as a settlement, and skips all-zero lines", () => {
    const loan = planLine(people, g.lines.find((l) => l.description === "Inspecteur")!, [
      { group: "test", date: "2026-09-23", description: "Inspecteur", asSettlement: true, note: "Prêt" },
    ]);
    expect(loan).toMatchObject({ kind: "settlement", from: "Sam", to: "Alex Tremblay", amountCents: 25_850, note: "Prêt" });
    expect(planLine(people, g.lines.find((l) => l.description === "Bizarre")!, []).kind).toBe("skip");
  });

  it("gives stable, distinct idempotency keys", () => {
    const again = parseSplitwiseExport("test", csv);
    expect(again.lines.map((l) => l.key)).toEqual(g.lines.map((l) => l.key));
    expect(new Set(g.lines.map((l) => l.key)).size).toBe(g.lines.length);
  });

  it("maps categories from the description first, with typo fixes", () => {
    expect(categorize("Costoc", "General").category).toBe("Épicerie");
    expect(categorize("Tigaz", "General").category).toBe("Divers");
    expect(categorize("Gaz", "General").category).toBe("Transport (STM, BIXI, auto)");
    expect(categorize("Metro", "Bus/train").category).toBe("Transport (STM, BIXI, auto)");
    expect(categorize("Métro", "General").category).toBe("Épicerie");
    expect(categorize("Hydro", "General").category).toBe("Électricité (Hydro-Québec)");
    expect(categorize("Electro", "Electricity").category).toBe("Meubles et déco");
    expect(categorize("Indian", "Dining out").category).toBe("Resto");
    expect(categorize("Hotel japan", "Hotel").category).toBe("Voyages");
    expect(categorize("Frais condi", "General").category).toBe("Frais de condo");
    expect(categorize("Assurances auto", "Car").category).toBe("Transport (STM, BIXI, auto)");
    expect(categorize("Uber eats", "Taxi").category).toBe("Resto");
  });
});
