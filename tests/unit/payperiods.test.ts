import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addMonths,
  diffDays,
  fromEpochDay,
  isThreePaydayMonth,
  monthRange,
  paydaysBetween,
  payPeriodsForMonth,
  payPeriodsInMonth,
  toEpochDay,
} from "../../src/domain";

const ANCHOR = "2026-01-02";

describe("pay periods (biweekly)", () => {
  it("paydaysBetween with anchor before / after / inside range", () => {
    expect(paydaysBetween(ANCHOR, "2026-01-01", "2026-02-15")).toEqual(["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13"]);
    expect(paydaysBetween("2027-01-01", "2026-12-01", "2026-12-31")).toEqual(["2026-12-04", "2026-12-18"]);
    expect(paydaysBetween(ANCHOR, "2026-01-16", "2026-01-16")).toEqual(["2026-01-16"]);
    expect(paydaysBetween(ANCHOR, "2026-01-17", "2026-01-29")).toEqual([]);
    expect(paydaysBetween(ANCHOR, "2026-02-01", "2026-01-01")).toEqual([]);
  });

  it("three-payday months for anchor 2026-01-02 are January and July 2026", () => {
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2026-01", i));
    const three = months.filter((m) => isThreePaydayMonth(ANCHOR, m));
    expect(three).toEqual(["2026-01", "2026-07"]);
    expect(payPeriodsForMonth(ANCHOR, "2026-01")).toEqual([
      { payday: "2026-01-02", start: "2026-01-02", endExclusive: "2026-01-16" },
      { payday: "2026-01-16", start: "2026-01-16", endExclusive: "2026-01-30" },
      { payday: "2026-01-30", start: "2026-01-30", endExclusive: "2026-02-13" },
    ]);
    expect(payPeriodsForMonth(ANCHOR, "2026-07").map((p) => p.payday)).toEqual(["2026-07-03", "2026-07-17", "2026-07-31"]);
    expect(payPeriodsInMonth(ANCHOR, "2026-11").map((p) => p.payday)).toEqual(["2026-11-06", "2026-11-20"]);
  });

  it("property: every month has 2 or 3 paydays, 14 days apart, inside the month; 26/27 per year", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: toEpochDay("2015-01-01"), max: toEpochDay("2035-12-31") }).map(fromEpochDay),
        fc.integer({ min: 0, max: 200 }),
        (anchor, offset) => {
          const month = addMonths("2020-01", offset);
          const periods = payPeriodsForMonth(anchor, month);
          expect(periods.length === 2 || periods.length === 3).toBe(true);
          const { start, endExclusive } = monthRange(month);
          periods.forEach((p, i) => {
            expect(p.payday >= start && p.payday < endExclusive).toBe(true);
            expect(Math.abs(diffDays(anchor, p.payday) % 14)).toBe(0);
            expect(diffDays(p.start, p.endExclusive)).toBe(14);
            if (i > 0) expect(diffDays(periods[i - 1].payday, p.payday)).toBe(14);
          });
          const yearCount = paydaysBetween(anchor, `${month.slice(0, 4)}-01-01`, `${month.slice(0, 4)}-12-31`).length;
          expect(yearCount === 26 || yearCount === 27).toBe(true);
        },
      ),
    );
  });
});
