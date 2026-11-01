import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DomainError,
  allocate,
  balanceSentence,
  computeBalances,
  minimalTransfers,
  type BalanceExpense,
  type BalanceInput,
  type BalanceRefund,
  type BalanceSettlement,
} from "../../src/domain";

const A = "alex";
const B = "sam";
const ORDER = [A, B];

const exp = (id: string, amount: number, paidBy: string | null, shares: Record<string, number>, isPrivate = false): BalanceExpense => ({
  id,
  amountCents: amount,
  paidByUser: paidBy,
  isPrivate,
  splits: Object.entries(shares).map(([userId, shareCents]) => ({ userId, shareCents })),
});

const sumNet = (net: Record<string, number>) => Object.values(net).reduce((a, b) => a + b, 0);

describe("computeBalances: rules", () => {
  it("expense paid by a member", () => {
    const r = computeBalances({ memberOrder: ORDER, expenses: [exp("e1", 10000, A, { [A]: 5000, [B]: 5000 })], refunds: [], settlements: [] });
    expect(r.net).toEqual({ [A]: 5000, [B]: -5000 });
    expect(r.transfers).toEqual([{ from: B, to: A, amountCents: 5000 }]);
  });

  it("joint-account and private expenses are ignored", () => {
    const r = computeBalances({
      memberOrder: ORDER,
      expenses: [exp("e1", 10000, null, { [A]: 5000, [B]: 5000 }), exp("e2", 7000, A, { [A]: 3500, [B]: 3500 }, true)],
      refunds: [{ expenseId: "e1", amountCents: 1000, receivedByUser: A }, { expenseId: "e2", amountCents: 1000, receivedByUser: A }],
      settlements: [],
    });
    expect(r.net).toEqual({ [A]: 0, [B]: 0 });
    expect(r.transfers).toEqual([]);
  });

  it("refund vs settlement behave differently", () => {
    const base = exp("e1", 10000, A, { [A]: 6000, [B]: 4000 });
    const refund = computeBalances({
      memberOrder: ORDER,
      expenses: [base],
      refunds: [{ expenseId: "e1", amountCents: 1000, receivedByUser: A }],
      settlements: [],
    });
    // A received 10 $ back: A −1000 + 600, B + 400 → B owes 4000 − 400
    expect(refund.net).toEqual({ [A]: 3600, [B]: -3600 });

    const refundToB = computeBalances({
      memberOrder: ORDER,
      expenses: [base],
      refunds: [{ expenseId: "e1", amountCents: 1000, receivedByUser: B }],
      settlements: [],
    });
    expect(refundToB.net).toEqual({ [A]: 4600, [B]: -4600 });

    const settle = computeBalances({
      memberOrder: ORDER,
      expenses: [base],
      refunds: [],
      settlements: [{ fromUser: B, toUser: A, amountCents: 1000 }],
    });
    expect(settle.net).toEqual({ [A]: 3000, [B]: -3000 });
  });

  it("refund to joint account / unknown expense is ignored", () => {
    const r = computeBalances({
      memberOrder: ORDER,
      expenses: [exp("e1", 10000, A, { [A]: 5000, [B]: 5000 })],
      refunds: [{ expenseId: "e1", amountCents: 1000, receivedByUser: null }, { expenseId: "nope", amountCents: 1000, receivedByUser: A }],
      settlements: [],
    });
    expect(r.net).toEqual({ [A]: 5000, [B]: -5000 });
  });

  it("refund allocation uses largest remainder in member order", () => {
    const r = computeBalances({
      memberOrder: ORDER,
      expenses: [exp("e1", 2, A, { [B]: 1, [A]: 1 })],
      refunds: [{ expenseId: "e1", amountCents: 1, receivedByUser: B }],
      settlements: [],
    });
    // refund cent goes to A (first in member order): A: 2 −1 +1 = 2 ; B: −1 −1 +0 = −2
    expect(r.net).toEqual({ [A]: 2, [B]: -2 });
  });

  it("rejects splits that don't sum to the amount", () => {
    expect(() =>
      computeBalances({ memberOrder: ORDER, expenses: [exp("e1", 100, A, { [A]: 50 })], refunds: [], settlements: [] }),
    ).toThrow(DomainError);
  });

  it("three members: greedy transfers settle everything", () => {
    const order = ["a", "b", "c"];
    const r = computeBalances({
      memberOrder: order,
      expenses: [exp("e1", 9000, "a", { a: 3000, b: 3000, c: 3000 }), exp("e2", 3000, "b", { a: 1000, b: 1000, c: 1000 })],
      refunds: [],
      settlements: [],
    });
    expect(r.net).toEqual({ a: 5000, b: -1000, c: -4000 });
    expect(r.transfers).toEqual([
      { from: "c", to: "a", amountCents: 4000 },
      { from: "b", to: "a", amountCents: 1000 },
    ]);
  });

  it("balanceSentence", () => {
    expect(balanceSentence({ [A]: 500, [B]: -500 }, A, "Sam")).toEqual({ kind: "owed", amountCents: 500, partnerName: "Sam" });
    expect(balanceSentence({ [A]: 500, [B]: -500 }, B, "Alex")).toEqual({ kind: "owes", amountCents: 500, partnerName: "Alex" });
    expect(balanceSentence({ [A]: 0, [B]: 0 }, B, "Alex").kind).toBe("even");
  });
});

// ---------------------------------------------------------------------------

const MEMBERS = ["m0", "m1", "m2"];
const member = fc.constantFrom(...MEMBERS);

const expenseArb = (i: number) =>
  fc
    .record({
      amount: fc.integer({ min: 0, max: 5_000_000 }),
      paidBy: fc.option(member, { freq: 4 }),
      isPrivate: fc.boolean(),
      weights: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 3, maxLength: 3 }),
    })
    .map(({ amount, paidBy, isPrivate, weights }): BalanceExpense => {
      const ws = weights.every((w) => w === 0) ? [1, 0, 0] : weights;
      const parts = allocate(amount, ws.map((w, k) => ({ id: MEMBERS[k], weight: w })));
      return {
        id: `e${i}`,
        amountCents: amount,
        paidByUser: paidBy,
        isPrivate,
        splits: parts.filter((_, k) => ws[k] > 0).map((p) => ({ userId: p.id, shareCents: p.cents })),
      };
    });

const inputArb: fc.Arbitrary<BalanceInput> = fc
  .integer({ min: 0, max: 12 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => expenseArb(i))))
  .chain((expenses) =>
    fc.record({
      memberOrder: fc.constant(MEMBERS),
      expenses: fc.constant(expenses as BalanceExpense[]),
      refunds: fc.array(
        fc.record<BalanceRefund>({
          expenseId: fc.constantFrom("e0", "e1", "e2", "e3", "missing"),
          amountCents: fc.integer({ min: 0, max: 1_000_000 }),
          receivedByUser: fc.option(member, { freq: 4 }),
        }),
        { maxLength: 6 },
      ),
      settlements: fc.array(
        fc.record<BalanceSettlement>({ fromUser: member, toUser: member, amountCents: fc.integer({ min: 0, max: 1_000_000 }) }),
        { maxLength: 6 },
      ),
    }),
  );

describe("computeBalances: properties", () => {
  it("Σ net = 0 and transfers zero the balances", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = computeBalances(input);
        expect(sumNet(r.net)).toBe(0);
        Object.values(r.net).forEach((v) => expect(Number.isSafeInteger(v)).toBe(true));
        r.transfers.forEach((t) => expect(t.amountCents).toBeGreaterThan(0));
        expect(r.transfers.length).toBeLessThanOrEqual(Math.max(0, MEMBERS.length - 1));
        const after = computeBalances({
          ...input,
          settlements: [...input.settlements, ...r.transfers.map((t) => ({ fromUser: t.from, toUser: t.to, amountCents: t.amountCents }))],
        });
        Object.values(after.net).forEach((v) => expect(v).toBe(0));
        expect(after.transfers).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it("joint-account expenses (and their refunds) never change balances", () => {
    fc.assert(
      fc.property(inputArb, expenseArb(99), fc.integer({ min: 0, max: 100000 }), member, (input, extra, refundAmt, who) => {
        const before = computeBalances(input);
        const joint = { ...extra, paidByUser: null };
        const after = computeBalances({
          ...input,
          expenses: [...input.expenses, joint],
          refunds: [...input.refunds, { expenseId: joint.id, amountCents: refundAmt, receivedByUser: who }],
        });
        expect(after.net).toEqual(before.net);
      }),
      { numRuns: 300 },
    );
  });

  it("settlement only affects from/to; refund moves every participant proportionally", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100_000 }),
        (amount, w0, w1, w2, x) => {
          const parts = allocate(amount, [w0, w1, w2].map((w, k) => ({ id: MEMBERS[k], weight: w })));
          const e: BalanceExpense = {
            id: "e",
            amountCents: amount,
            paidByUser: "m0",
            isPrivate: false,
            splits: parts.map((p) => ({ userId: p.id, shareCents: p.cents })),
          };
          const base = computeBalances({ memberOrder: MEMBERS, expenses: [e], refunds: [], settlements: [] }).net;
          const s = computeBalances({
            memberOrder: MEMBERS,
            expenses: [e],
            refunds: [],
            settlements: [{ fromUser: "m1", toUser: "m0", amountCents: x }],
          }).net;
          expect(s.m0 - base.m0).toBe(-x);
          expect(s.m1 - base.m1).toBe(x);
          expect(s.m2 - base.m2).toBe(0);

          const r = computeBalances({
            memberOrder: MEMBERS,
            expenses: [e],
            refunds: [{ expenseId: "e", amountCents: x, receivedByUser: "m0" }],
            settlements: [],
          }).net;
          const refundShares = allocate(x, parts.filter((p) => p.cents > 0).map((p) => ({ id: p.id, weight: p.cents })));
          for (const m of MEMBERS) {
            const share = refundShares.find((p) => p.id === m)?.cents ?? 0;
            expect(r[m] - base[m]).toBe(share - (m === "m0" ? x : 0));
          }
        },
      ),
    );
  });

  it("minimalTransfers is deterministic", () => {
    expect(minimalTransfers({ a: 100, b: -50, c: -50 }, ["a", "b", "c"])).toEqual([
      { from: "b", to: "a", amountCents: 50 },
      { from: "c", to: "a", amountCents: 50 },
    ]);
  });
});
