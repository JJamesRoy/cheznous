"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button, Sheet, SheetFooter, toast, undoable } from "@/components/ui";
import { ApiError, callOp } from "@/lib/data/api";
import { newIdempotencyKey, runOrQueue } from "@/lib/data/offline-queue";
import { haptic } from "@/lib/ui/haptics";
import type { QuickAddSheetProps } from "@/features/app/quick-add-sheets";
import { useMembers, useSession } from "@/features/app/session";
import { ExpenseFields, emptyExpenseForm, expenseInput, validateExpense, type ExpenseFormErrors, type ExpenseFormState } from "./expense-form";
import type { Expense } from "./shared";

/**
 * Add an expense in under five seconds: amount (keypad opens at once) → description with
 * history suggestions → payer → split → Ajouter. Works offline (queued with its idempotency key).
 *
 * `prefill` accepts: amount (string "12,50" or integer cents), amountCents, description,
 * category (id or name), payer ("me" | "partner" | "joint" | user id), project, spentOn,
 * notes, isPrivate, receiptPath, shoppingItemId, and an `onCreated(expense)` callback.
 */
export function QuickAddExpense({ open, onOpenChange, prefill }: QuickAddSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nouvelle dépense">
      {/* Mounted per opening: fresh state and a fresh idempotency key each time. */}
      <QuickAddExpenseForm onDone={() => onOpenChange(false)} prefill={prefill} />
    </Sheet>
  );
}

function QuickAddExpenseForm({ onDone, prefill }: { onDone: () => void; prefill?: Record<string, unknown> }) {
  const session = useSession();
  const { me, partner } = useMembers();
  const qc = useQueryClient();
  // One key per sheet opening: double taps and retries never duplicate the expense.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [state, setState] = useState<ExpenseFormState>(() => emptyExpenseForm(session, me, partner, prefill));
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const errors: ExpenseFormErrors = submitted ? validateExpense(state, partner) : {};

  async function submit() {
    if (inFlight.current || receiptBusy) return;
    const errs = validateExpense(state, partner);
    if (errs.amount) {
      setSubmitted(true);
      amountRef.current?.focus();
      return;
    }
    if (errs.description) {
      // Enter in the amount field simply moves on to the description.
      if (document.activeElement === amountRef.current && !submitted) {
        descriptionRef.current?.focus();
        return;
      }
      setSubmitted(true);
      descriptionRef.current?.focus();
      return;
    }
    if (errs.split) {
      setSubmitted(true);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setServerError(null);
    const shoppingItemId = typeof prefill?.shoppingItemId === "string" ? prefill.shoppingItemId : undefined;
    try {
      const res = await runOrQueue("expenses.create", {
        ...expenseInput(state, me, partner),
        idempotencyKey,
        ...(shoppingItemId ? { shoppingItemId } : {}),
      });
      onDone();
      if (res.queued) {
        toast("En attente de synchronisation", { description: `« ${state.description.trim()} » sera ajoutée au retour du réseau.` });
        return;
      }
      haptic("success");
      void qc.invalidateQueries({ queryKey: ["op"] });
      const created = res.data.expense;
      if (typeof prefill?.onCreated === "function") (prefill.onCreated as (e: Expense) => void)(created);
      undoable("Dépense ajoutée", async () => {
        try {
          await callOp("expenses.delete", { id: created.id });
          void qc.invalidateQueries({ queryKey: ["op"] });
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Impossible d'annuler.");
        }
      });
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "La dépense n'a pas pu être ajoutée. Réessaie.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        // ⌘/Ctrl+Enter from the notes field submits too.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <ExpenseFields
        state={state}
        onChange={setState}
        errors={errors}
        variant="quick"
        amountRef={amountRef}
        descriptionRef={descriptionRef}
        onReceiptBusy={setReceiptBusy}
      />
      {serverError ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {serverError}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={receiptBusy}>
          {receiptBusy ? "Envoi du reçu…" : "Ajouter"}
        </Button>
      </SheetFooter>
    </form>
  );
}
