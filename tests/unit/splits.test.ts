import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DomainError, allocate, computeSplits, describeSplit, type SplitMode } from "../../src/domain";

function errCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

const weightsArb = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 8 }).filter((ws) => ws.some((w) => w > 0));

describe("allocate", () => {
  it("examples", () => {
    expect(allocate(100, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }])).toEqual([
      { id: "a", cents: 34 },
      { id: "b", cents: 33 },
      { id: "c", cents: 33 },
    ]);
    // 1001 × 5500/10000 = 550.55 ; × 4500/10000 = 450.45 → a gets the cent
    expect(allocate(1001, [{ id: "a", weight: 5500 }, { id: "b", weight: 4500 }]).map((x) => x.cents)).toEqual([551, 450]);
    // largest remainder beats order: b has the bigger remainder
    expect(allocate(1001, [{ id: "a", weight: 4500 }, { id: "b", weight: 5500 }]).map((x) => x.cents)).toEqual([450, 551]);
    expect(allocate(1, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }]).map((x) => x.cents)).toEqual([1, 0]);
    expect(allocate(1, [{ id: "b", weight: 1 }, { id: "a", weight: 1 }])[0]).toEqual({ id: "b", cents: 1 });
    expect(allocate(0, [{ id: "a", weight: 3 }])).toEqual([{ id: "a", cents: 0 }]);
    expect(allocate(500, [{ id: "a", weight: 0 }, { id: "b", weight: 7 }]).map((x) => x.cents)).toEqual([0, 500]);
  });

  it("is BigInt-exact for huge totals", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const r = allocate(total, [{ id: "a", weight: 3333 }, { id: "b", weight: 6667 }]);
    expect(BigInt(r[0].cents) + BigInt(r[1].cents)).toBe(BigInt(total));
  });

  it("rejects bad input", () => {
    expect(errCode(() => allocate(100, []))).toBe("ALLOCATE_NO_WEIGHTS");
    expect(errCode(() => allocate(100, [{ id: "a", weight: 0 }]))).toBe("ALLOCATE_ZERO_WEIGHTS");
    expect(errCode(() => allocate(100, [{ id: "a", weight: -1 }]))).toBe("ALLOCATE_INVALID_WEIGHT");
    expect(errCode(() => allocate(100, [{ id: "a", weight: 1.5 }]))).toBe("ALLOCATE_INVALID_WEIGHT");
    expect(errCode(() => allocate(-1, [{ id: "a", weight: 1 }]))).toBe("INVALID_AMOUNT");
    expect(errCode(() => allocate(1.5, [{ id: "a", weight: 1 }]))).toBe("INVALID_AMOUNT");
  });

  it("property: sums to total, within 1 cent of exact share, deterministic, input order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), weightsArb, (total, ws) => {
        const input = ws.map((w, i) => ({ id: `u${i}`, weight: w }));
        const out = allocate(total, input);
        expect(out.map((o) => o.id)).toEqual(input.map((i) => i.id));
        expect(out.reduce((a, o) => a + o.cents, 0)).toBe(total);
        const sum = BigInt(ws.reduce((a, w) => a + w, 0));
        out.forEach((o, i) => {
          const exactFloor = (BigInt(total) * BigInt(ws[i])) / sum;
          const c = BigInt(o.cents);
          expect(c === exactFloor || c === exactFloor + BigInt(1)).toBe(true);
          if (ws[i] === 0) expect(o.cents).toBe(0);
        });
        expect(allocate(total, input)).toEqual(out);
      }),
      { numRuns: 1000 },
    );
  });

  it("property: equal weights differ by at most 1 cent and extra cents go first", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 10 }), (total, n) => {
        const out = allocate(total, Array.from({ length: n }, (_, i) => ({ id: String(i), weight: 1 }))).map((o) => o.cents);
        const sorted = [...out].sort((a, b) => b - a);
        expect(out).toEqual(sorted);
        expect(out[0] - out[n - 1]).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("computeSplits", () => {
  const members = ["alex", "sam"];

  it("equal", () => {
    expect(computeSplits({ totalCents: 8501, mode: "equal", memberOrder: members })).toEqual([
      { userId: "alex", shareCents: 4251, weight: 1 },
      { userId: "sam", shareCents: 4250, weight: 1 },
    ]);
    expect(computeSplits({ totalCents: 8501, mode: "equal", memberOrder: members, participants: ["sam"] })).toEqual([
      { userId: "sam", shareCents: 8501, weight: 1 },
    ]);
    // output follows memberOrder, not participants order
    expect(
      computeSplits({ totalCents: 3, mode: "equal", memberOrder: members, participants: ["sam", "alex"] }).map((s) => s.userId),
    ).toEqual(["alex", "sam"]);
    expect(errCode(() => computeSplits({ totalCents: 1, mode: "equal", memberOrder: members, participants: [] }))).toBe(
      "SPLIT_NO_PARTICIPANTS",
    );
  });

  it("percentage", () => {
    expect(
      computeSplits({ totalCents: 10000, mode: "percentage", memberOrder: members, percentagesBp: { sam: 4500, alex: 5500 } }),
    ).toEqual([
      { userId: "alex", shareCents: 5500, weight: 5500 },
      { userId: "sam", shareCents: 4500, weight: 4500 },
    ]);
    expect(
      computeSplits({ totalCents: 999, mode: "percentage", memberOrder: members, percentagesBp: { alex: 10000, sam: 0 } }),
    ).toEqual([
      { userId: "alex", shareCents: 999, weight: 10000 },
      { userId: "sam", shareCents: 0, weight: 0 },
    ]);
    expect(
      errCode(() => computeSplits({ totalCents: 1, mode: "percentage", memberOrder: members, percentagesBp: { alex: 5000, sam: 4999 } })),
    ).toBe("SPLIT_PERCENT_SUM");
    expect(
      errCode(() => computeSplits({ totalCents: 1, mode: "percentage", memberOrder: members, percentagesBp: { alex: 5000.5, sam: 4999.5 } })),
    ).toBe("SPLIT_PERCENT_SUM");
    expect(errCode(() => computeSplits({ totalCents: 1, mode: "percentage", memberOrder: members }))).toBe("SPLIT_PERCENT_SUM");
    expect(
      errCode(() => computeSplits({ totalCents: 1, mode: "percentage", memberOrder: members, percentagesBp: { alex: 5000, zoe: 5000 } })),
    ).toBe("SPLIT_UNKNOWN_MEMBER");
  });

  it("income", () => {
    expect(
      computeSplits({ totalCents: 200000, mode: "income", memberOrder: members, incomeWeightsBp: { alex: 5500, sam: 4500 } }),
    ).toEqual([
      { userId: "alex", shareCents: 110000, weight: 5500 },
      { userId: "sam", shareCents: 90000, weight: 4500 },
    ]);
    expect(errCode(() => computeSplits({ totalCents: 1, mode: "income", memberOrder: members, incomeWeightsBp: { alex: 5500 } }))).toBe(
      "SPLIT_INCOME_MISSING",
    );
    expect(
      errCode(() => computeSplits({ totalCents: 1, mode: "income", memberOrder: members, incomeWeightsBp: { alex: 0, sam: 0 } })),
    ).toBe("SPLIT_INCOME_MISSING");
    expect(errCode(() => computeSplits({ totalCents: 1, mode: "income", memberOrder: members }))).toBe("SPLIT_INCOME_MISSING");
  });

  it("exact", () => {
    expect(computeSplits({ totalCents: 1000, mode: "exact", memberOrder: members, exactCents: { sam: 300, alex: 700 } })).toEqual([
      { userId: "alex", shareCents: 700, weight: null },
      { userId: "sam", shareCents: 300, weight: null },
    ]);
    try {
      computeSplits({ totalCents: 1000, mode: "exact", memberOrder: members, exactCents: { sam: 300, alex: 600 } });
      expect.fail();
    } catch (e) {
      expect((e as DomainError).code).toBe("SPLIT_EXACT_SUM");
      expect((e as DomainError).details).toEqual({ expected: 1000, actual: 900 });
    }
    expect(errCode(() => computeSplits({ totalCents: 1000, mode: "exact", memberOrder: members, exactCents: { bob: 1000 } }))).toBe(
      "SPLIT_UNKNOWN_MEMBER",
    );
  });

  it("unknown participants", () => {
    expect(errCode(() => computeSplits({ totalCents: 1, mode: "equal", memberOrder: members, participants: ["zoe"] }))).toBe(
      "SPLIT_UNKNOWN_MEMBER",
    );
  });

  it("property: every mode sums to total", () => {
    const arb = fc.record({
      total: fc.integer({ min: 0, max: 100_000_000 }),
      n: fc.integer({ min: 1, max: 4 }),
      mode: fc.constantFrom<SplitMode>("equal", "percentage", "exact", "income"),
      seed: fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 4, maxLength: 4 }),
    });
    fc.assert(
      fc.property(arb, ({ total, n, mode, seed }) => {
        const memberOrder = Array.from({ length: n }, (_, i) => `m${i}`);
        const ws = seed.slice(0, n);
        if (!ws.some((w) => w > 0)) ws[0] = 1;
        const input: Parameters<typeof computeSplits>[0] = { totalCents: total, mode, memberOrder };
        if (mode === "percentage") {
          const bp = ws.map((w) => w);
          const s = bp.reduce((a, b) => a + b, 0);
          const scaled = bp.map((w) => Math.floor((w * 10000) / s));
          scaled[0] += 10000 - scaled.reduce((a, b) => a + b, 0);
          input.percentagesBp = Object.fromEntries(memberOrder.map((m, i) => [m, scaled[i]]));
        } else if (mode === "income") {
          input.incomeWeightsBp = Object.fromEntries(memberOrder.map((m, i) => [m, ws[i]]));
        } else if (mode === "exact") {
          const parts = allocate(total, ws.map((w, i) => ({ id: memberOrder[i], weight: w })));
          input.exactCents = Object.fromEntries(parts.map((p) => [p.id, p.cents]));
        }
        const out = computeSplits(input);
        expect(out.reduce((a, s) => a + s.shareCents, 0)).toBe(total);
        expect(out.map((s) => s.userId)).toEqual(memberOrder.filter((m) => out.some((s) => s.userId === m)));
        out.forEach((s) => expect(s.shareCents).toBeGreaterThanOrEqual(0));
      }),
      { numRuns: 1000 },
    );
  });
});

describe("describeSplit", () => {
  it("labels", () => {
    expect(describeSplit([{ userId: "a", shareCents: 500 }, { userId: "b", shareCents: 500 }], ["a", "b"]).label).toBe("50/50");
    expect(describeSplit([{ userId: "b", shareCents: 45 }, { userId: "a", shareCents: 55 }], ["a", "b"]).label).toBe("55/45");
    expect(describeSplit([{ userId: "a", shareCents: 1000 }], ["a", "b"]).label).toBe("100/0");
    expect(describeSplit([{ userId: "a", shareCents: 1 }, { userId: "b", shareCents: 2 }], ["a", "b"]).label).toBe("33/67");
    expect(describeSplit([], ["a", "b"]).label).toBe("—");
  });
  it("percents always sum to 100", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1e9 }), { minLength: 1, maxLength: 5 }), (shares) => {
        fc.pre(shares.some((s) => s > 0));
        const order = shares.map((_, i) => `u${i}`);
        const d = describeSplit(shares.map((s, i) => ({ userId: order[i], shareCents: s })), order);
        expect(d.percents.reduce((a, p) => a + p.percent, 0)).toBe(100);
      }),
    );
  });
});
