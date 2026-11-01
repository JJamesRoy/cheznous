"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useQuickAdd, type QuickAddKind } from "./quick-add";

// Each create sheet (forms, Vaul, image compression…) is fetched the first time it is opened,
// keeping it out of every screen's initial JavaScript.
const loadExpense = () => import("@/features/expenses/quick-add-expense");
const loadItem = () => import("@/features/lists/quick-add-item");
const loadTask = () => import("@/features/tasks/quick-add-task");
const loadNote = () => import("@/features/notes/quick-add-note");
const QuickAddExpense = dynamic(() => loadExpense().then((m) => m.QuickAddExpense), { ssr: false });
const QuickAddItem = dynamic(() => loadItem().then((m) => m.QuickAddItem), { ssr: false });
const QuickAddTask = dynamic(() => loadTask().then((m) => m.QuickAddTask), { ssr: false });
const QuickAddNote = dynamic(() => loadNote().then((m) => m.QuickAddNote), { ssr: false });

/** Mounted once in the app frame; opens the right create sheet for useQuickAdd().open(kind). */
export function QuickAddSheets() {
  const { state, close } = useQuickAdd();
  // Not in the first load, but fetched right after it while the browser is idle: the sheets must
  // open instantly and keep working offline (adding an expense or an item is an offline write).
  useEffect(() => {
    const preload = () => void Promise.all([loadExpense(), loadItem(), loadTask(), loadNote()]).catch(() => undefined);
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(preload, { timeout: 2000 });
    else setTimeout(preload, 600);
  }, []);
  const [used, setUsed] = useState<Set<QuickAddKind>>(() => new Set());
  if (state && !used.has(state.kind)) setUsed(new Set(used).add(state.kind));
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  const props = (kind: QuickAddKind) => ({
    open: state?.kind === kind,
    onOpenChange,
    prefill: state?.kind === kind ? state.prefill : undefined,
  });
  return (
    <>
      {used.has("expense") ? <QuickAddExpense {...props("expense")} /> : null}
      {used.has("item") ? <QuickAddItem {...props("item")} /> : null}
      {used.has("task") ? <QuickAddTask {...props("task")} /> : null}
      {used.has("note") ? <QuickAddNote {...props("note")} /> : null}
    </>
  );
}

export type QuickAddSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: Record<string, unknown>;
};
