"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type QuickAddKind = "expense" | "item" | "task" | "note";
export type QuickAddState = { kind: QuickAddKind; prefill?: Record<string, unknown> } | null;

type Ctx = {
  state: QuickAddState;
  open: (kind?: QuickAddKind, prefill?: Record<string, unknown>) => void;
  close: () => void;
};

const QuickAddContext = createContext<Ctx | null>(null);

/** Global "create" sheets (expense, list item, task, note) opened from anywhere: +, N, ⌘K. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QuickAddState>(null);
  const open = useCallback((kind: QuickAddKind = "expense", prefill?: Record<string, unknown>) => setState({ kind, prefill }), []);
  const close = useCallback(() => setState(null), []);
  const value = useMemo(() => ({ state, open, close }), [state, open, close]);
  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

export function useQuickAdd(): Ctx {
  const c = useContext(QuickAddContext);
  if (!c) throw new Error("useQuickAdd must be used inside QuickAddProvider");
  return c;
}
