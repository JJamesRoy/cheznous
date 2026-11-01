import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FREQUENCIES,
  FREQUENCY_LABELS_FR,
  MAX_OCCURRENCES,
  addMonthsClamped,
  fromEpochDay,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  toEpochDay,
  type Frequency,
  type RecurrenceRule,
} from "../../src/domain";

describe("labels", () => {
  it("has French labels for every frequency", () => {
    expect(FREQUENCY_LABELS_FR.bimonthly).toBe("Aux deux mois");
    expect(FREQUENCY_LABELS_FR.installments).toBe("Versements à dates fixes");
    for (const f of FREQUENCIES) expect(FREQUENCY_LABELS_FR[f]).toBeTruthy();
  });
});

describe("occurrencesBetween", () => {
  it("weekly / biweekly", () => {
    expect(occurrencesBetween({ frequency: "weekly", anchorDate: "2026-11-02" }, "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    expect(occurrencesBetween({ frequency: "biweekly", anchorDate: "2026-01-02" }, "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-06",
      "2026-11-20",
    ]);
  });

  it("monthly clamps to month end without drifting", () => {
    expect(occurrencesBetween({ frequency: "monthly", anchorDate: "2026-01-31" }, "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(occurrencesBetween({ frequency: "monthly", anchorDate: "2023-01-31" }, "2024-02-01", "2024-03-31")).toEqual([
      "2024-02-29",
      "2024-03-31",
    ]);
  });

  it("bimonthly (Hydro-Québec)", () => {
    expect(occurrencesBetween({ frequency: "bimonthly", anchorDate: "2026-01-20" }, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-20",
      "2026-03-20",
      "2026-05-20",
      "2026-07-20",
      "2026-09-20",
      "2026-11-20",
    ]);
    expect(occurrencesBetween({ frequency: "bimonthly", anchorDate: "2025-12-31" }, "2026-01-01", "2026-06-30")).toEqual([
      "2026-02-28",
      "2026-04-30",
      "2026-06-30",
    ]);
  });

  it("quarterly / semiannual / yearly", () => {
    expect(occurrencesBetween({ frequency: "quarterly", anchorDate: "2025-11-30" }, "2026-01-01", "2026-12-31")).toEqual([
      "2026-02-28",
      "2026-05-30",
      "2026-08-30",
      "2026-11-30",
    ]);
    expect(occurrencesBetween({ frequency: "semiannual", anchorDate: "2026-03-15" }, "2026-01-01", "2027-12-31")).toEqual([
      "2026-03-15",
      "2026-09-15",
      "2027-03-15",
      "2027-09-15",
    ]);
    expect(occurrencesBetween({ frequency: "yearly", anchorDate: "2024-02-29" }, "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("installments (taxes municipales): explicit, sorted, deduped, bounded", () => {
    const rule: RecurrenceRule = {
      frequency: "installments",
      anchorDate: "2026-03-01",
      installmentDates: ["2026-09-01", "2026-03-01", "2026-06-01", "2026-06-01", "2027-03-01"],
    };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toEqual(["2026-03-01", "2026-06-01", "2026-09-01"]);
    expect(occurrencesBetween({ ...rule, endDate: "2026-07-01" }, "2026-01-01", "2027-12-31")).toEqual(["2026-03-01", "2026-06-01"]);
    expect(() => occurrencesBetween({ frequency: "installments", anchorDate: "2026-01-01" }, "2026-01-01", "2026-12-31")).toThrow(
      expect.objectContaining({ code: "INSTALLMENTS_MISSING" }),
    );
  });

  it("respects anchor, endDate, empty ranges, inclusive bounds", () => {
    const rule: RecurrenceRule = { frequency: "monthly", anchorDate: "2026-05-10", endDate: "2026-08-10" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toEqual(["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"]);
    expect(occurrencesBetween(rule, "2026-06-10", "2026-06-10")).toEqual(["2026-06-10"]);
    expect(occurrencesBetween(rule, "2026-06-11", "2026-07-09")).toEqual([]);
    expect(occurrencesBetween(rule, "2026-12-01", "2026-01-01")).toEqual([]);
    expect(occurrencesBetween(rule, "2020-01-01", "2026-04-30")).toEqual([]);
  });

  it("caps huge ranges", () => {
    const out = occurrencesBetween({ frequency: "weekly", anchorDate: "1990-01-01" }, "1990-01-01", "2099-12-31");
    expect(out.length).toBe(MAX_OCCURRENCES);
  });

  it("property: month-based = anchor + k×step, sorted, within bounds, for every frequency", () => {
    const steps: Record<Exclude<Frequency, "installments">, { months?: number; days?: number }> = {
      weekly: { days: 7 },
      biweekly: { days: 14 },
      monthly: { months: 1 },
      bimonthly: { months: 2 },
      quarterly: { months: 3 },
      semiannual: { months: 6 },
      yearly: { months: 12 },
    };
    const day = (lo: string, hi: string) => fc.integer({ min: toEpochDay(lo), max: toEpochDay(hi) }).map(fromEpochDay);
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(steps) as (keyof typeof steps)[])),
        day("2020-01-01", "2030-12-31"),
        day("2018-01-01", "2032-12-31"),
        fc.integer({ min: 0, max: 900 }),
        (freq, anchor, from, len) => {
          const to = fromEpochDay(toEpochDay(from) + len);
          const rule = { frequency: freq, anchorDate: anchor };
          const out = occurrencesBetween(rule, from, to);
          // brute-force reference
          const expected: string[] = [];
          for (let k = 0; k < 2000; k++) {
            const s = steps[freq];
            const d = s.days ? fromEpochDay(toEpochDay(anchor) + k * s.days) : addMonthsClamped(anchor, k * s.months!, Number(anchor.slice(8)));
            if (d > to) break;
            if (d >= from) expected.push(d);
          }
          expect(out).toEqual(expected);
          const next = nextOccurrenceOnOrAfter(rule, from);
          if (out.length > 0) expect(next).toBe(out[0]);
          else if (next !== null) expect(next > to).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("nextOccurrenceOnOrAfter", () => {
  it("examples", () => {
    expect(nextOccurrenceOnOrAfter({ frequency: "monthly", anchorDate: "2026-01-31" }, "2026-02-01")).toBe("2026-02-28");
    expect(nextOccurrenceOnOrAfter({ frequency: "monthly", anchorDate: "2026-01-31" }, "2026-03-01")).toBe("2026-03-31");
    expect(nextOccurrenceOnOrAfter({ frequency: "weekly", anchorDate: "2026-11-02" }, "2026-01-01")).toBe("2026-11-02");
    expect(nextOccurrenceOnOrAfter({ frequency: "biweekly", anchorDate: "2026-01-02" }, "2026-11-07")).toBe("2026-11-20");
    expect(nextOccurrenceOnOrAfter({ frequency: "monthly", anchorDate: "2026-01-15", endDate: "2026-03-01" }, "2026-02-16")).toBeNull();
    expect(
      nextOccurrenceOnOrAfter({ frequency: "installments", anchorDate: "2026-03-01", installmentDates: ["2026-09-01", "2026-03-01"] }, "2026-03-02"),
    ).toBe("2026-09-01");
    expect(
      nextOccurrenceOnOrAfter({ frequency: "installments", anchorDate: "2026-03-01", installmentDates: ["2026-03-01"] }, "2026-03-02"),
    ).toBeNull();
    expect(nextOccurrenceOnOrAfter({ frequency: "biweekly", anchorDate: "2026-01-02" }, "2026-11-06")).toBe("2026-11-06");
  });
});
