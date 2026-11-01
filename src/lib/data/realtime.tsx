"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/** Which op caches a change in each table can affect. */
const TABLE_OPS: Record<string, string[]> = {
  expenses: ["expenses.list", "expenses.get", "balances.get", "budget.get", "budget.history", "dashboard.get", "spending.summary", "projects.list", "projects.get"],
  expense_splits: ["expenses.list", "expenses.get", "balances.get", "dashboard.get"],
  refunds: ["expenses.list", "expenses.get", "balances.get", "budget.get", "dashboard.get"],
  settlements: ["balances.get", "dashboard.get"],
  contributions: ["contributions.summary"],
  budgets: ["budget.get", "budget.history", "dashboard.get"],
  budget_categories: ["session.get", "budget.get", "categories.list"],
  shopping_lists: ["shopping.lists", "shopping.list", "session.get", "dashboard.get"],
  shopping_items: ["shopping.lists", "shopping.list", "dashboard.get"],
  tasks: ["tasks.list", "tasks.get", "dashboard.get", "condo.listMaintenance"],
  task_checklist_items: ["tasks.list", "tasks.get"],
  notes: ["notes.list", "notes.get", "notes.search"],
  household_members: ["session.get", "dashboard.get"],
  households: ["session.get", "dashboard.get"],
  savings_goals: ["goals.list", "goals.get", "dashboard.get"],
  goal_contributions: ["goals.list", "goals.get", "dashboard.get"],
  projects: ["projects.list", "projects.get", "session.get"],
};

/**
 * One Realtime channel per household. Postgres changes are RLS-filtered by Supabase, so a
 * partner never receives the other's private rows. Each change invalidates the affected caches.
 */
export function useHouseholdRealtime(householdId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!householdId) return;
    const supabase = getBrowserSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flush = () => {
      timer = null;
      const names = [...pending];
      pending.clear();
      names.forEach((n) => void qc.invalidateQueries({ queryKey: ["op", n] }));
    };
    const channel = supabase.channel(`household:${householdId}`);
    for (const table of Object.keys(TABLE_OPS)) {
      const filter = table === "households" ? `id=eq.${householdId}` : `household_id=eq.${householdId}`;
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
        TABLE_OPS[table].forEach((n) => pending.add(n));
        if (!timer) timer = setTimeout(flush, 120);
      });
    }
    // Splits have household_id too; deletes only carry the PK, which is fine: we just invalidate.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [householdId, qc]);
}
