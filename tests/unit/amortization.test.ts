import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  amortizationSchedule,
  computePayment,
  paymentDate,
  paymentsPerYear,
  periodicRate,
  prepaymentPrivilege,
  summarizeMortgage,
  type PaymentFrequency,
} from "../../src/domain";

const annuity = (principal: number, i: number, n: number) => (principal * i) / (1 - Math.pow(1 + i, -n));

describe("rates & payments", () => {
  it("paymentsPerYear", () => {
    const f: PaymentFrequency[] = ["monthly", "semimonthly", "biweekly", "accelerated_biweekly", "weekly", "accelerated_weekly"];
    expect(f.map(paymentsPerYear)).toEqual([12, 24, 26, 26, 52, 52]);
  });

  it("semi-annual compounding (Interest Act): 500 000 $ at 5 %, 25 years, monthly", () => {
    // From first principles: i = (1 + 0.05/2)^(2/12) − 1 = 1.025^(1/6) − 1
    const iSemi = Math.pow(1.025, 1 / 6) - 1;
    expect(periodicRate(5, 12, "semiannual")).toBeCloseTo(iSemi, 15);
    expect(iSemi).toBeCloseTo(0.0041239154651, 12);
    const expectedSemi = Math.round(annuity(50_000_000, iSemi, 300)); // 290 802.49… ¢
    // Hardcoded: 2 908,02 $ (Canadian fixed-rate, semi-annual compounding)
    expect(expectedSemi).toBe(290802);
    expect(computePayment({ principalCents: 50_000_000, annualRatePct: 5, amortizationMonths: 300, frequency: "monthly", compounding: "semiannual" })).toBe(290802);

    // Monthly compounding: i = 0.05/12 → 2 922,95 $
    const iMonthly = 0.05 / 12;
    expect(periodicRate(5, 12, "monthly")).toBeCloseTo(iMonthly, 15);
    const expectedMonthly = Math.round(annuity(50_000_000, iMonthly, 300)); // 292 295.02… ¢
    expect(expectedMonthly).toBe(292295);
    expect(computePayment({ principalCents: 50_000_000, annualRatePct: 5, amortizationMonths: 300, frequency: "monthly", compounding: "monthly" })).toBe(292295);
  });

  it("other frequencies", () => {
    const base = { principalCents: 50_000_000, annualRatePct: 5, amortizationMonths: 300, compounding: "semiannual" as const };
    const iBi = Math.pow(1.025, 2 / 26) - 1;
    expect(computePayment({ ...base, frequency: "biweekly" })).toBe(Math.round(annuity(50_000_000, iBi, 650)));
    expect(computePayment({ ...base, frequency: "accelerated_biweekly" })).toBe(145401); // 290 802 / 2
    expect(computePayment({ ...base, frequency: "accelerated_weekly" })).toBe(72701); // 290 802 / 4 = 72 700,5 → 72 701
    const iSemiMonthly = Math.pow(1.025, 2 / 24) - 1;
    expect(computePayment({ ...base, frequency: "semimonthly" })).toBe(Math.round(annuity(50_000_000, iSemiMonthly, 600)));
    expect(computePayment({ ...base, annualRatePct: 0, frequency: "monthly" })).toBe(166667);
  });
});

describe("amortizationSchedule", () => {
  it("monthly schedule pays off in 300 periods and balances to zero", () => {
    const rows = amortizationSchedule({
      balanceCents: 50_000_000,
      annualRatePct: 5,
      paymentCents: 290802,
      frequency: "monthly",
      compounding: "semiannual",
      startDate: "2026-01-31",
    });
    expect(rows[0]).toEqual({
      n: 1,
      date: "2026-01-31",
      paymentCents: 290802,
      interestCents: 206196, // 50 000 000 × 0.0041239154… = 206 195.77 → 206 196
      principalCents: 84606,
      balanceCents: 49_915_394,
    });
    expect(rows[1].date).toBe("2026-02-28");
    expect(rows[2].date).toBe("2026-03-31");
    expect(rows.length).toBeGreaterThanOrEqual(299);
    expect(rows.length).toBeLessThanOrEqual(301);
    const last = rows[rows.length - 1];
    expect(last.balanceCents).toBe(0);
    expect(last.paymentCents).toBeLessThanOrEqual(290802);
    const s = summarizeMortgage(rows);
    expect(s.paidOff).toBe(true);
    expect(s.payoffDate).toBe(last.date);
    expect(s.totalPaidCents - s.totalInterestCents).toBe(50_000_000);
  });

  it("accelerated biweekly pays off faster", () => {
    const common = { balanceCents: 50_000_000, annualRatePct: 5, compounding: "semiannual" as const, startDate: "2026-01-02" };
    const acc = amortizationSchedule({ ...common, paymentCents: 145401, frequency: "accelerated_biweekly" });
    expect(acc[1].date).toBe("2026-01-16");
    const yearsAcc = acc.length / 26;
    expect(yearsAcc).toBeLessThan(23);
    expect(yearsAcc).toBeGreaterThan(20);
  });

  it("throws PAYMENT_TOO_LOW", () => {
    expect(() =>
      amortizationSchedule({ balanceCents: 50_000_000, annualRatePct: 5, paymentCents: 206196, frequency: "monthly", compounding: "semiannual", startDate: "2026-01-01" }),
    ).toThrow(expect.objectContaining({ code: "PAYMENT_TOO_LOW" }));
  });

  it("respects maxPeriods and zero balance", () => {
    expect(
      amortizationSchedule({ balanceCents: 50_000_000, annualRatePct: 5, paymentCents: 290802, frequency: "monthly", compounding: "semiannual", startDate: "2026-01-01", maxPeriods: 12 }),
    ).toHaveLength(12);
    expect(amortizationSchedule({ balanceCents: 0, annualRatePct: 5, paymentCents: 1, frequency: "monthly", compounding: "semiannual", startDate: "2026-01-01" })).toEqual([]);
  });

  it("payment dates", () => {
    expect([0, 1, 2, 3].map((k) => paymentDate("2026-01-01", "semimonthly", k))).toEqual(["2026-01-01", "2026-01-16", "2026-02-01", "2026-02-16"]);
    expect([0, 1, 2].map((k) => paymentDate("2026-01-05", "weekly", k))).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("property: principal sums to balance, balance non-increasing", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 200_000_000 }), // 1 000 $ – 2 M$
        fc.double({ min: 0.5, max: 12, noNaN: true }),
        fc.integer({ min: 5, max: 30 }),
        fc.constantFrom<PaymentFrequency>("monthly", "semimonthly", "biweekly", "accelerated_biweekly", "weekly", "accelerated_weekly"),
        (principal, rate, years, frequency) => {
          const payment = computePayment({ principalCents: principal, annualRatePct: rate, amortizationMonths: years * 12, frequency, compounding: "semiannual" });
          const rows = amortizationSchedule({ balanceCents: principal, annualRatePct: rate, paymentCents: payment, frequency, compounding: "semiannual", startDate: "2026-01-01", maxPeriods: 5000 });
          expect(rows[rows.length - 1].balanceCents).toBe(0);
          expect(rows.reduce((a, r) => a + r.principalCents, 0)).toBe(principal);
          for (let k = 1; k < rows.length; k++) {
            expect(rows[k].balanceCents).toBeLessThan(rows[k - 1].balanceCents);
            expect(rows[k].date > rows[k - 1].date).toBe(true);
          }
          // Payoff matches the closed-form period count for the actual (rounded) payment:
          // N* = −ln(1 − B·i/pmt) / ln(1 + i); per-period interest rounding adds < 1 period of drift.
          const i = periodicRate(rate, paymentsPerYear(frequency), "semiannual");
          const nStar = -Math.log(1 - (principal * i) / payment) / Math.log(1 + i);
          expect(Math.abs(rows.length - Math.ceil(nStar))).toBeLessThanOrEqual(2);
          const nominal = Math.round((years * 12 * paymentsPerYear(frequency)) / 12);
          if (frequency.startsWith("accelerated")) expect(rows.length).toBeLessThan(nominal);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("prepaymentPrivilege", () => {
  const base = { originalPrincipalCents: 50_000_000, privilegeBp: 1500, anniversaryDate: "2025-06-15" };

  it("allowed = 15 % of original, year runs anniversary to anniversary", () => {
    const r = prepaymentPrivilege({
      ...base,
      prepayments: [
        { amountCents: 1_000_000, paidOn: "2026-06-14" }, // previous privilege year
        { amountCents: 2_000_000, paidOn: "2026-06-15" },
        { amountCents: 500_000, paidOn: "2027-01-10" },
        { amountCents: 9_999_999, paidOn: "2027-06-15" }, // next year
      ],
      today: "2027-02-01",
    });
    expect(r).toEqual({
      yearStart: "2026-06-15",
      yearEndExclusive: "2027-06-15",
      allowedCents: 7_500_000,
      usedCents: 2_500_000,
      remainingCents: 5_000_000,
    });
  });

  it("across the anniversary the counter resets", () => {
    const prepayments = [{ amountCents: 7_500_000, paidOn: "2026-06-14" }];
    const before = prepaymentPrivilege({ ...base, prepayments, today: "2026-06-14" });
    expect(before.yearStart).toBe("2025-06-15");
    expect(before.remainingCents).toBe(0);
    const on = prepaymentPrivilege({ ...base, prepayments, today: "2026-06-15" });
    expect(on.yearStart).toBe("2026-06-15");
    expect(on.yearEndExclusive).toBe("2027-06-15");
    expect(on.usedCents).toBe(0);
    expect(on.remainingCents).toBe(7_500_000);
  });

  it("over-use clamps remaining at 0; Feb 29 anniversaries; floor of allowed", () => {
    expect(prepaymentPrivilege({ ...base, prepayments: [{ amountCents: 9_000_000, paidOn: "2026-07-01" }], today: "2026-08-01" }).remainingCents).toBe(0);
    const leap = prepaymentPrivilege({ originalPrincipalCents: 33_333, privilegeBp: 1000, anniversaryDate: "2024-02-29", prepayments: [], today: "2026-03-01" });
    expect(leap.yearStart).toBe("2026-02-28");
    expect(leap.yearEndExclusive).toBe("2027-02-28");
    expect(leap.allowedCents).toBe(3333);
  });
});
