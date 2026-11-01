"use client";

import { QuickAddExpense } from "@/features/expenses/quick-add-expense";
import { QuickAddItem } from "@/features/lists/quick-add-item";
import { QuickAddTask } from "@/features/tasks/quick-add-task";
import { QuickAddNote } from "@/features/notes/quick-add-note";
import { useQuickAdd } from "./quick-add";

/** Mounted once in the app frame; opens the right create sheet for useQuickAdd().open(kind). */
export function QuickAddSheets() {
  const { state, close } = useQuickAdd();
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  return (
    <>
      <QuickAddExpense open={state?.kind === "expense"} onOpenChange={onOpenChange} prefill={state?.kind === "expense" ? state.prefill : undefined} />
      <QuickAddItem open={state?.kind === "item"} onOpenChange={onOpenChange} prefill={state?.kind === "item" ? state.prefill : undefined} />
      <QuickAddTask open={state?.kind === "task"} onOpenChange={onOpenChange} prefill={state?.kind === "task" ? state.prefill : undefined} />
      <QuickAddNote open={state?.kind === "note"} onOpenChange={onOpenChange} prefill={state?.kind === "note" ? state.prefill : undefined} />
    </>
  );
}

export type QuickAddSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: Record<string, unknown>;
};
