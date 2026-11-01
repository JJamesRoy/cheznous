import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DomainError,
  addDays,
  addMonths,
  addMonthsClamped,
  dayOfWeek,
  daysInMonth,
  diffDays,
  diffMonths,
  formatDateFr,
  formatDateShortFr,
  formatMonthFr,
  fromEpochDay,
  monthOf,
  monthRange,
  nowPartsIn,
  parseDate,
  parseMonth,
  relativeDayFr,
  toEpochDay,
  todayIn,
  weekRange,
} from "../../src/domain";

const civilDate = fc.integer({ min: toEpochDay("1990-01-01"), max: toEpochDay("2100-12-31") }).map(fromEpochDay);

describe("todayIn (America/Toronto)", () => {
  it("month boundary: 03:30 UTC on Dec 1 is still Nov 30 in Montréal", () => {
    expect(todayIn("America/Toronto", new Date("2026-12-01T03:30:00Z"))).toBe("2026-11-30");
    expect(todayIn("America/Toronto", new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
    expect(todayIn("UTC", new Date("2026-12-01T03:30:00Z"))).toBe("2026-12-01");
  });
  it("year boundary and DST", () => {
    expect(todayIn("America/Toronto", new Date("2027-01-01T04:59:59Z"))).toBe("2026-12-31");
    expect(todayIn("America/Toronto", new Date("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
    // EDT (UTC−4) in July
    expect(todayIn("America/Toronto", new Date("2026-07-01T03:59:00Z"))).toBe("2026-06-30");
    expect(todayIn("America/Toronto", new Date("2026-07-01T04:00:00Z"))).toBe("2026-07-01");
    // DST fall-back day, 2026-11-01
    expect(todayIn("America/Toronto", new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
  });
  it("nowPartsIn gives local hour", () => {
    expect(nowPartsIn("America/Toronto", new Date("2026-12-01T03:30:15Z"))).toEqual({
      date: "2026-11-30",
      hour: 22,
      minute: 30,
      second: 15,
    });
    expect(nowPartsIn("America/Toronto", new Date("2026-12-01T05:00:00Z")).hour).toBe(0);
  });
  it("invalid zone", () => {
    expect(() => todayIn("Mars/Olympus")).toThrow(DomainError);
  });
});

describe("parseDate / parseMonth", () => {
  it.each(["2026-01-01", "2024-02-29", "2026-12-31", "2000-02-29"])("accepts %s", (d) => expect(parseDate(d)).toBe(d));
  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-1-01", "26-01-01", "2026-01-32", "", "2026/01/01", "1900-02-29", "2026-01-01T00:00"])(
    "rejects %j",
    (d) => {
      expect(() => parseDate(d)).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    },
  );
  it("months", () => {
    expect(parseMonth("2026-11")).toBe("2026-11");
    expect(() => parseMonth("2026-13")).toThrow(expect.objectContaining({ code: "INVALID_MONTH" }));
  });
});

describe("arithmetic", () => {
  it("addDays / diffDays / dayOfWeek", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-01-01", "2026-12-31")).toBe(364);
    expect(diffDays("2026-03-08", "2026-03-09")).toBe(1); // DST change does not matter
    expect(dayOfWeek("2026-11-01")).toBe(0); // dimanche
    expect(dayOfWeek("1970-01-01")).toBe(4);
    expect(dayOfWeek("1969-12-31")).toBe(3);
  });

  it("addMonthsClamped without drift", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-01-15", -13)).toBe("2024-12-15");
    const chain = [0, 1, 2, 3, 4].map((k) => addMonthsClamped("2026-01-31", k, 31));
    expect(chain).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("months", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-11-15")).toBe(30);
    expect(monthOf("2026-11-15")).toBe("2026-11");
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", endExclusive: "2026-03-01" });
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(diffMonths("2026-11", "2027-02")).toBe(3);
  });

  it("weekRange", () => {
    expect(weekRange("2026-11-04")).toEqual({ start: "2026-11-01", endExclusive: "2026-11-08" });
    expect(weekRange("2026-11-01")).toEqual({ start: "2026-11-01", endExclusive: "2026-11-08" });
    expect(weekRange("2026-11-01", 1)).toEqual({ start: "2026-10-26", endExclusive: "2026-11-02" });
    expect(weekRange("2026-11-02", 1)).toEqual({ start: "2026-11-02", endExclusive: "2026-11-09" });
  });

  it("properties", () => {
    fc.assert(
      fc.property(civilDate, fc.integer({ min: -2000, max: 2000 }), (d, n) => {
        expect(diffDays(d, addDays(d, n))).toBe(n);
        expect(fromEpochDay(toEpochDay(d))).toBe(d);
        expect(dayOfWeek(addDays(d, 7))).toBe(dayOfWeek(d));
        expect(dayOfWeek(d)).toBe(new Date(`${d}T00:00:00Z`).getUTCDay());
      }),
    );
    fc.assert(
      fc.property(civilDate, fc.integer({ min: 0, max: 6 }), (d, ws) => {
        const w = weekRange(d, ws);
        expect(dayOfWeek(w.start)).toBe(ws);
        expect(w.start <= d && d < w.endExclusive).toBe(true);
      }),
    );
    fc.assert(
      fc.property(civilDate, fc.integer({ min: -60, max: 60 }), (d, n) => {
        const r = addMonthsClamped(d, n);
        expect(diffMonths(monthOf(d), monthOf(r))).toBe(n);
        expect(Number(r.slice(8))).toBe(Math.min(Number(d.slice(8)), daysInMonth(monthOf(r))));
      }),
    );
  });
});

describe("French formatting", () => {
  it("formats", () => {
    expect(formatDateFr("2026-11-01")).toBe("1 nov. 2026");
    expect(formatDateFr("2026-05-31")).toBe("31 mai 2026");
    expect(formatDateShortFr("2026-11-01")).toBe("1 nov.");
    expect(formatDateShortFr("2026-02-14")).toBe("14 févr.");
    expect(formatMonthFr("2026-11")).toBe("novembre 2026");
    expect(formatMonthFr("2027-08")).toBe("août 2027");
  });
  it("relativeDayFr", () => {
    const t = "2026-11-01";
    expect(relativeDayFr("2026-11-01", t)).toBe("aujourd'hui");
    expect(relativeDayFr("2026-11-02", t)).toBe("demain");
    expect(relativeDayFr("2026-10-31", t)).toBe("hier");
    expect(relativeDayFr("2026-11-04", t)).toBe("dans 3 jours");
    expect(relativeDayFr("2026-10-30", t)).toBe("il y a 2 jours");
  });
});
