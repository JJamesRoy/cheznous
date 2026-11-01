import { describe, expect, it } from "vitest";
import { NO_CATEGORY, budgetStatus, compareMonths, effectiveBudgets, spendingByCategory } from "../../src/domain";

describe("effectiveBudgets", () => {
  const rows = [
    { categoryId: "epicerie", month: "2026-01-01", amountCents: 80000 },
    { categoryId: "epicerie", month: "2026-09-01", amountCents: 90000 },
    { categoryId: "resto", month: "2026-11-01", amountCents: 20000 },
    { categoryId: "loisirs", month: "2027-01-01", amountCents: 5000 },
  ];
  it("takes the latest row with month ≤ target", () => {
    expect(effectiveBudgets(rows, "2026-08")).toEqual({ epicerie: 80000 });
    expect(effectiveBudgets(rows, "2026-09")).toEqual({ epicerie: 90000 });
    expect(effectiveBudgets(rows, "2026-11")).toEqual({ epicerie: 90000, resto: 20000 });
    expect(effectiveBudgets(rows, "2027-02")).toEqual({ epicerie: 90000, resto: 20000, loisirs: 5000 });
    expect(effectiveBudgets(rows, "2025-12")).toEqual({});
  });
  it("is independent of row order", () => {
    expect(effectiveBudgets([...rows].reverse(), "2026-11")).toEqual({ epicerie: 90000, resto: 20000 });
  });
});

describe("spendingByCategory", () => {
  const range = { start: "2026-11-01", endExclusive: "2026-12-01" };
  it("excludes private, out-of-range; refunds reduce; clamps at 0", () => {
    const out = spendingByCategory(
      [
        { categoryId: "epicerie", amountCents: 10000, isPrivate: false, spentOn: "2026-11-01" },
        { categoryId: "epicerie", amountCents: 5000, isPrivate: false, spentOn: "2026-11-30" },
        { categoryId: "epicerie", amountCents: 7000, isPrivate: true, spentOn: "2026-11-10" },
        { categoryId: "epicerie", amountCents: 9999, isPrivate: false, spentOn: "2026-12-01" },
        { categoryId: "epicerie", amountCents: 9999, isPrivate: false, spentOn: "2026-10-31" },
        { categoryId: null, amountCents: 1234, isPrivate: false, spentOn: "2026-11-15" },
        { categoryId: "resto", amountCents: 1000, isPrivate: false, spentOn: "2026-11-15" },
      ],
      [
        { categoryId: "epicerie", amountCents: 2000, refundedOn: "2026-11-20" },
        { categoryId: "resto", amountCents: 5000, refundedOn: "2026-11-20" },
        { categoryId: "epicerie", amountCents: 2000, refundedOn: "2026-12-02" },
      ],
      range,
    );
    expect(out).toEqual({ epicerie: 13000, [NO_CATEGORY]: 1234, resto: 0 });
  });
});

describe("budgetStatus", () => {
  it("states", () => {
    expect(budgetStatus({ budgetCents: null, spentCents: 500, month: "2026-11", today: "2026-11-15" }).state).toBe("none");
    expect(budgetStatus({ budgetCents: 0, spentCents: 500, month: "2026-11", today: "2026-11-15" }).ratio).toBe(0);
    expect(budgetStatus({ budgetCents: 10000, spentCents: 8499, month: "2026-11", today: "2026-11-15" }).state).toBe("under");
    expect(budgetStatus({ budgetCents: 10000, spentCents: 8500, month: "2026-11", today: "2026-11-15" }).state).toBe("warning");
    expect(budgetStatus({ budgetCents: 10000, spentCents: 10000, month: "2026-11", today: "2026-11-15" }).state).toBe("warning");
    const over = budgetStatus({ budgetCents: 10000, spentCents: 10001, month: "2026-11", today: "2026-11-15" });
    expect(over.state).toBe("over");
    expect(over.remainingCents).toBe(-1);
  });
  it("projection: current month counts today; past = spent; future = 0", () => {
    // 15 days elapsed (today counts), 30 days in November: 30000 / 15 × 30
    expect(budgetStatus({ budgetCents: 50000, spentCents: 30000, month: "2026-11", today: "2026-11-15" }).projectedCents).toBe(60000);
    // first day: 1000 × 30
    expect(budgetStatus({ budgetCents: 50000, spentCents: 1000, month: "2026-11", today: "2026-11-01" }).projectedCents).toBe(5143); // 1000 + 1000/7 × 29
    // rounding: 1000 / 7 × 30 = 4285.71 → 4286
    expect(budgetStatus({ budgetCents: 50000, spentCents: 1000, month: "2026-11", today: "2026-11-07" }).projectedCents).toBe(4286);
    expect(budgetStatus({ budgetCents: 50000, spentCents: 1000, month: "2026-10", today: "2026-11-07" }).projectedCents).toBe(1000);
    expect(budgetStatus({ budgetCents: 50000, spentCents: 1000, month: "2026-12", today: "2026-11-07" }).projectedCents).toBe(0);
  });
});

describe("compareMonths", () => {
  it("sorts by |delta| desc then id", () => {
    expect(compareMonths({ a: 1000, b: 500, c: 300 }, { a: 1200, b: 0, d: 200 })).toEqual([
      { categoryId: "b", aCents: 500, bCents: 0, deltaCents: -500 },
      { categoryId: "c", aCents: 300, bCents: 0, deltaCents: -300 },
      { categoryId: "a", aCents: 1000, bCents: 1200, deltaCents: 200 },
      { categoryId: "d", aCents: 0, bCents: 200, deltaCents: 200 },
    ]);
  });
});
