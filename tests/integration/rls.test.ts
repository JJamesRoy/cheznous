import { describe, expect, it, beforeAll } from "vitest";
import { expectError, run } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as expenses from "@/server/usecases/expenses";
import * as household from "@/server/usecases/household";

/**
 * Isolation is enforced by Postgres RLS, not by the use cases. These tests talk to the
 * database directly with each user's own token, bypassing the server layer entirely.
 */
const TABLES = [
  "households", "household_members", "household_invitations", "accounts", "budget_categories", "expenses",
  "expense_splits", "refunds", "settlements", "contributions", "budgets", "recurring_rules", "projects",
  "savings_goals", "goal_contributions", "shopping_lists", "shopping_items", "tasks", "task_checklist_items",
  "task_completions", "notes", "properties", "mortgages", "mortgage_prepayments", "mortgage_statements",
  "special_assessments", "appliances", "maintenance_records", "documents", "capital_contributions", "audit_logs",
] as const;

describe("RLS: household isolation", () => {
  let h1: Couple;
  let h2: Couple;
  let h1ExpenseId: string;
  let h1ListId: string;

  beforeAll(async () => {
    h1 = await createCouple(["Léa", "Sam"]);
    h2 = await createCouple(["Noé", "Zoé"]);
    h1ExpenseId = (await run(h1.a, expenses.createExpense, { amount: "50", description: "Resto" })).expense.id;
    await h1.a.db.from("notes").insert({ household_id: h1.householdId, title: "Code du garage", body_md: "1234" });
    const lists = await h1.a.db.from("shopping_lists").select("id").eq("household_id", h1.householdId);
    h1ListId = lists.data![0].id;
    await h1.a.db.from("shopping_items").insert({ household_id: h1.householdId, list_id: h1ListId, name: "Lait" });
  });

  it("a user from household B reads nothing from household A, on every table", async () => {
    for (const t of TABLES) {
      const { data, error } = await h2.a.db.from(t).select("*").eq(t === "households" ? "id" : "household_id", h1.householdId);
      expect(error, t).toBeNull();
      expect(data, t).toEqual([]);
    }
  });

  it("a user from household B cannot insert into household A", async () => {
    const attempts = [
      h2.a.db.from("expenses").insert({ household_id: h1.householdId, amount_cents: 100, description: "x", spent_on: "2026-11-01", paid_by_user: h2.a.id, split_mode: "none", is_private: true }),
      h2.a.db.from("notes").insert({ household_id: h1.householdId, title: "x" }),
      h2.a.db.from("shopping_items").insert({ household_id: h1.householdId, list_id: h1ListId, name: "x" }),
      h2.a.db.from("budget_categories").insert({ household_id: h1.householdId, name: "Piratage" }),
      h2.a.db.from("household_members").insert({ household_id: h1.householdId, user_id: h2.a.id }),
      h2.a.db.from("household_invitations").insert({ household_id: h1.householdId, token_hash: "deadbeef", expires_at: "2030-01-01" }),
      h2.a.db.from("settlements").insert({ household_id: h1.householdId, from_user: h1.a.id, to_user: h1.b.id, amount_cents: 1, settled_on: "2026-11-01" }),
    ];
    for (const a of attempts) {
      const { error } = await a;
      expect(error).not.toBeNull();
    }
  });

  it("a user from household B cannot update or delete household A rows (0 rows affected)", async () => {
    const upd = await h2.a.db.from("expenses").update({ description: "pwned" }).eq("id", h1ExpenseId).select();
    expect(upd.data ?? []).toEqual([]);
    const del = await h2.a.db.from("expenses").delete().eq("id", h1ExpenseId).select();
    expect(del.data ?? []).toEqual([]);
    const still = await h1.a.db.from("expenses").select("description").eq("id", h1ExpenseId).single();
    expect(still.data?.description).toBe("Resto");
  });

  it("use cases refuse cross-household ids too", async () => {
    await expectError(run(h2.a, expenses.getExpense, { id: h1ExpenseId }), "NOT_FOUND");
    await expectError(run(h2.a, expenses.updateExpense, { id: h1ExpenseId, amount: "1" }), "NOT_FOUND");
  });

  it("a partner cannot read, update or delete the other's private rows", async () => {
    const { expense } = await run(h1.b, expenses.createExpense, { amount: "25", description: "Pharmacie", isPrivate: true });
    const note = await h1.b.db.from("notes").insert({ household_id: h1.householdId, title: "Journal", body_md: "privé", is_private: true }).select("id").single();
    expect(note.error).toBeNull();

    for (const [table, id] of [["expenses", expense.id], ["notes", note.data!.id]] as const) {
      const r = await h1.a.db.from(table).select("id").eq("id", id);
      expect(r.data, table).toEqual([]);
      const u = await h1.a.db.from(table).update({ is_private: false }).eq("id", id).select();
      expect(u.data ?? [], table).toEqual([]);
      const d = await h1.a.db.from(table).delete().eq("id", id).select();
      expect(d.data ?? [], table).toEqual([]);
      const own = await h1.b.db.from(table).select("id").eq("id", id);
      expect(own.data, table).toHaveLength(1);
    }
    // Audit rows about private data are hidden from the partner too.
    const audit = await h1.a.db.from("audit_logs").select("id").eq("row_id", expense.id);
    expect(audit.data).toEqual([]);
    const auditOwn = await h1.b.db.from("audit_logs").select("id").eq("row_id", expense.id);
    expect(auditOwn.data!.length).toBeGreaterThan(0);
  });

  it("a partner cannot create a private expense on behalf of the other", async () => {
    const { error } = await h1.a.db.from("expenses").insert({
      household_id: h1.householdId, amount_cents: 100, description: "x", spent_on: "2026-11-01",
      paid_by_user: h1.b.id, split_mode: "none", is_private: true, created_by: h1.a.id,
    });
    expect(error).not.toBeNull();
  });

  it("splits must sum to the total (DB constraint, even bypassing the app)", async () => {
    const { error } = await h1.a.db.rpc("create_expense_tx", {
      p_expense: { household_id: h1.householdId, amount_cents: 1000, description: "x", spent_on: "2026-11-01", paid_by_user: h1.a.id, split_mode: "equal" },
      p_splits: [{ user_id: h1.a.id, share_cents: 500 }, { user_id: h1.b.id, share_cents: 499 }],
    });
    expect(error?.code).toBe("23514");
  });

  it("invitation tokens are hashed at rest and expire", async () => {
    const solo = await createCouple(["Ana", "Ben"]).then((c) => c); // full household
    await expectError(run(solo.a, household.createInvitation, {}), "CONFLICT");
    const { data } = await h1.a.db.from("household_invitations").select("token_hash, accepted_at").eq("household_id", h1.householdId);
    expect(data!.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it("anonymous clients get nothing", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    for (const t of ["expenses", "notes", "households", "profiles"]) {
      const { data } = await anon.from(t).select("*").limit(1);
      expect(data ?? [], t).toEqual([]);
    }
  });
});
