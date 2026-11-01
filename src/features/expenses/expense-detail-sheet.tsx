"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileText, Lock, Pencil, Trash2, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import {
  Avatar,
  Button,
  ChipGroup,
  ConfirmDialog,
  DateInput,
  Field,
  Input,
  Money,
  MoneyInput,
  Sheet,
  SheetFooter,
  Skeleton,
  SkeletonText,
  toast,
  undoable,
} from "@/components/ui";
import { formatDateFr } from "@/domain/dates";
import { ApiError, callOp } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp, useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { useMembers, useSession } from "@/features/app/session";
import { ExpenseFields, expenseInput, formFromExpense, validateExpense, type ExpenseFormErrors, type ExpenseFormState } from "./expense-form";
import { useReceiptUrl } from "./receipt-field";
import { civilDateOf, incomeRatioLabel, splitLabel, type Expense } from "./shared";

/** Input that recreates a deleted expense (undo). */
function recreateInput(e: Expense) {
  const split =
    e.splitMode === "none" || e.isPrivate || e.payer.kind === "joint"
      ? undefined
      : e.splitMode === "exact"
        ? { mode: "exact" as const, exact: Object.fromEntries(e.splits.map((s) => [s.userId, { cents: s.shareCents }])) }
        : e.splitMode === "percentage"
          ? { mode: "percentage" as const, percentages: Object.fromEntries(e.splits.map((s) => [s.userId, (s.weight ?? 0) / 100])) }
          : e.splitMode === "equal"
            ? { mode: "equal" as const, participants: e.splits.map((s) => s.userId) }
            : { mode: "income" as const };
  return {
    amount: { cents: e.amountCents },
    description: e.description,
    spentOn: e.spentOn,
    category: e.category?.id ?? null,
    payer: e.payer.kind === "joint" ? "commun" : e.payer.userId,
    split,
    isPrivate: e.isPrivate,
    notes: e.notes,
    receiptPath: e.receiptPath,
    project: e.projectId,
    idempotencyKey: newIdempotencyKey(),
  };
}

/** Delete with an « Annuler » toast that recreates the expense. */
export function useDeleteExpense() {
  const qc = useQueryClient();
  return useCallback(
    async (e: Expense) => {
      try {
        await callOp("expenses.delete", { id: e.id });
        haptic("light");
        void qc.invalidateQueries({ queryKey: ["op"] });
        undoable(`« ${e.description} » supprimée`, async () => {
          try {
            await callOp("expenses.create", recreateInput(e));
            void qc.invalidateQueries({ queryKey: ["op"] });
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Impossible de rétablir la dépense.");
          }
        });
        return true;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "La dépense n'a pas pu être supprimée.");
        return false;
      }
    },
    [qc],
  );
}

type Mode = "view" | "edit" | "refund";

export function ExpenseDetailSheet({
  id,
  initial,
  initialMode = "view",
  onClose,
}: {
  id: string | null;
  /** Row data already on screen, shown while the fresh copy loads. */
  initial?: Expense | null;
  initialMode?: Mode;
  onClose: () => void;
}) {
  const [lastId, setLastId] = useState(id);
  if (id && id !== lastId) setLastId(id);
  const shownId = id ?? lastId;
  const q = useOp("expenses.get", { id: shownId ?? "" }, { enabled: Boolean(id), retry: false });
  const title = q.data?.expense.description ?? (initial?.id === shownId ? initial.description : "Dépense");
  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && onClose()} title={title} desktop="panel">
      {shownId ? <DetailBody key={shownId} id={shownId} active={Boolean(id)} initial={initial} initialMode={initialMode} onClose={onClose} /> : null}
    </Sheet>
  );
}

function DetailBody({ id, active, initial, initialMode, onClose }: { id: string; active: boolean; initial?: Expense | null; initialMode: Mode; onClose: () => void }) {
  const q = useOp("expenses.get", { id }, { retry: false, enabled: active });
  const expense = q.data?.expense ?? (initial?.id === id ? initial : null);
  const [mode, setMode] = useState<Mode>(initialMode);

  if (!expense) {
    if (q.error)
      return (
        <div role="alert" className="flex flex-col items-start gap-3 py-4 text-base text-fg-muted">
          {q.error.code === "NOT_FOUND" ? "Cette dépense n'existe plus." : q.error.message}
          {q.error.code !== "NOT_FOUND" ? (
            <Button size="sm" onClick={() => q.refetch()}>
              Réessayer
            </Button>
          ) : null}
        </div>
      );
    return (
      <div className="flex flex-col items-center gap-3 py-4" aria-busy>
        <Skeleton className="h-10 w-40" />
        <SkeletonText className="w-48" />
        <Skeleton shape="card" className="mt-4 h-40 w-full" />
      </div>
    );
  }
  if (mode === "edit") return <EditExpense expense={expense} onDone={() => setMode("view")} />;
  if (mode === "refund") return <RefundForm expense={expense} onDone={() => setMode("view")} />;
  return <ViewExpense expense={expense} onEdit={() => setMode("edit")} onRefund={() => setMode("refund")} onClose={onClose} />;
}

function ViewExpense({ expense: e, onEdit, onRefund, onClose }: { expense: Expense; onEdit: () => void; onRefund: () => void; onClose: () => void }) {
  const session = useSession();
  const { members } = useMembers();
  const ids = members.map((m) => m.userId);
  const del = useDeleteExpense();
  const [confirm, setConfirm] = useState(false);
  const receiptUrl = useReceiptUrl(e.receiptPath);
  const tz = session.household.timezone;
  const createdOn = civilDateOf(e.createdAt, tz);
  const updatedOn = civilDateOf(e.updatedAt, tz);
  const edited = new Date(e.updatedAt).getTime() - new Date(e.createdAt).getTime() > 60_000;
  const creator = members.find((m) => m.userId === e.createdBy);
  const payerTone = e.payer.kind === "joint" ? "joint" : toneForMember(ids, e.payer.userId).key;
  const modeLabel =
    e.splitMode === "income"
      ? `Selon les revenus · ${incomeRatioLabel(members) ?? ""}`
      : e.splitMode === "equal"
        ? "Égal · 50/50"
        : e.splitMode === "percentage"
          ? `Pourcentage · ${splitLabel(e, members)}`
          : e.splitMode === "exact"
            ? "Montants exacts"
            : null;
  const project = session.projects.find((p) => p.id === e.projectId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <Money cents={e.amountCents} className="text-2xl font-semibold text-fg" />
        <p className="text-sm text-fg-subtle">
          {formatDateFr(e.spentOn)} · {e.category?.name ?? "Sans catégorie"}
        </p>
        {e.isPrivate ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-fg-muted">
            <Lock aria-hidden className="size-3" /> Privé · hors balances
          </span>
        ) : null}
      </div>

      <dl className="flex flex-col rounded-inner bg-surface-2 px-4 py-1 text-base">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <dt className="text-fg-muted">Payé par</dt>
          <dd className="flex items-center gap-2 text-fg">
            <Avatar name={e.payer.kind === "joint" ? "Compte commun" : e.payer.name} size="sm" tone={payerTone} decorative />
            {e.payer.isMe ? "Toi" : e.payer.name}
          </dd>
        </div>
        {modeLabel && !e.isPrivate && e.payer.kind === "member" ? (
          <>
            <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border">
              <dt className="text-fg-muted">Partage</dt>
              <dd className="text-fg">{modeLabel}</dd>
            </div>
            {e.splits.map((s) => (
              <div key={s.userId} className="flex min-h-9 items-center justify-between gap-3 pl-3">
                <dt className="text-sm text-fg-muted">{members.find((m) => m.userId === s.userId)?.isMe ? "Ta part" : `Part de ${s.name}`}</dt>
                <dd>
                  <Money cents={s.shareCents} className="text-fg" />
                </dd>
              </div>
            ))}
          </>
        ) : null}
        {e.payer.kind === "joint" ? (
          <div className="flex min-h-11 items-center border-t border-border text-sm text-fg-subtle">Payée avec le compte commun : aucune dette entre vous.</div>
        ) : null}
        {e.refundedCents > 0 ? (
          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border">
            <dt className="text-fg-muted">Remboursé</dt>
            <dd className="text-fg">
              <Money cents={e.refundedCents} sign className="text-accent-ink" /> <span className="text-sm text-fg-subtle">· net</span> <Money cents={e.amountCents - e.refundedCents} />
            </dd>
          </div>
        ) : null}
        {project ? (
          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border">
            <dt className="text-fg-muted">Projet</dt>
            <dd className="text-fg">{project.name}</dd>
          </div>
        ) : null}
        {e.notes ? (
          <div className="flex flex-col gap-1 border-t border-border py-2.5">
            <dt className="text-fg-muted">Notes</dt>
            <dd className="whitespace-pre-wrap text-fg">{e.notes}</dd>
          </div>
        ) : null}
      </dl>

      {e.receiptPath ? (
        <a
          href={receiptUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-inner bg-surface-2 p-2 pr-4 hover:bg-surface-pressed"
          aria-label="Ouvrir le reçu"
        >
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface">
            {e.receiptPath.endsWith(".pdf") ? (
              <FileText aria-hidden className="size-5 text-fg-subtle" />
            ) : receiptUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL
              <img src={receiptUrl} alt="" className="size-full object-cover" />
            ) : (
              <Skeleton className="size-full" />
            )}
          </span>
          <span className="flex-1 text-base text-fg">Voir le reçu</span>
        </a>
      ) : null}

      <p className="text-sm text-fg-subtle">
        Ajoutée par {creator?.isMe ? "toi" : (creator?.displayName ?? "un ancien membre")} le {formatDateFr(createdOn)}
        {edited ? ` · modifiée le ${formatDateFr(updatedOn)}` : ""}
      </p>

      <SheetFooter className="flex-wrap">
        <Button variant="danger-ghost" onClick={() => setConfirm(true)}>
          <Trash2 aria-hidden /> Supprimer
        </Button>
        {!e.isPrivate && e.refundedCents < e.amountCents ? (
          <Button onClick={onRefund}>
            <Undo2 aria-hidden /> Remboursement
          </Button>
        ) : null}
        <Button variant="primary" onClick={onEdit}>
          <Pencil aria-hidden /> Modifier
        </Button>
      </SheetFooter>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Supprimer « ${e.description} » ?`}
        description={e.refundedCents > 0 ? "Ses remboursements seront aussi supprimés." : "Les balances et le budget seront recalculés."}
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (await del(e)) onClose();
        }}
      />
    </div>
  );
}

function EditExpense({ expense, onDone }: { expense: Expense; onDone: () => void }) {
  const session = useSession();
  const { me, partner } = useMembers();
  const [state, setState] = useState<ExpenseFormState>(() => formFromExpense(expense, session, me, partner));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const update = useOpMutation("expenses.update", {
    onSuccess: () => {
      haptic("success");
      onDone();
    },
    onError: (e) => setServerError(e.message),
  });

  const errors: ExpenseFormErrors = submitted ? validateExpense(state, partner) : {};

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        setSubmitted(true);
        const errs = validateExpense(state, partner);
        if (Object.keys(errs).length || receiptBusy) return;
        setServerError(null);
        update.mutate({ id: expense.id, ...expenseInput(state, me, partner) });
      }}
    >
      <ExpenseFields state={state} onChange={setState} errors={errors} variant="edit" canChangePrivacy={expense.createdBy === me.userId} onReceiptBusy={setReceiptBusy} />
      {serverError ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {serverError}
        </p>
      ) : null}
      <SheetFooter>
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" loading={update.isPending} disabled={receiptBusy}>
          Enregistrer
        </Button>
      </SheetFooter>
    </form>
  );
}

function RefundForm({ expense: e, onDone }: { expense: Expense; onDone: () => void }) {
  const session = useSession();
  const { me, partner, joint, members } = useMembers();
  const ids = members.map((m) => m.userId);
  const left = e.amountCents - e.refundedCents;
  const [key] = useState(newIdempotencyKey);
  const [text, setText] = useState(centsToInput(left));
  const [cents, setCents] = useState<number | null>(left);
  const defaultReceiver = e.payer.kind === "joint" ? "commun" : e.payer.userId;
  const [receiver, setReceiver] = useState<string>(defaultReceiver);
  const [date, setDate] = useState(session.today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useOpMutation("refunds.create", {
    onSuccess: () => {
      haptic("success");
      onDone();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!cents || cents <= 0) return setError("Entre le montant remboursé.");
        if (cents > left) return setError("Le remboursement dépasse ce qui reste de la dépense.");
        create.mutate({ expenseId: e.id, amount: { cents }, receivedBy: receiver, refundedOn: date, note: note.trim() || undefined, idempotencyKey: key });
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-medium text-fg">Remboursement · {e.description}</h2>
        <p className="text-sm text-fg-muted">
          L&apos;argent que le magasin te rend (retour, crédit) : il réduit la dépense et son partage. Un virement entre vous deux, c&apos;est plutôt « Régler » dans Balances.
        </p>
      </div>
      <Field label="Montant remboursé" hint={<>Jusqu&apos;à <Money cents={left} /></>}>
        <MoneyInput
          value={text}
          autoFocus
          onValueChange={(t, c) => {
            setText(t);
            setCents(c);
          }}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Reçu par</span>
        <ChipGroup
          aria-label="Reçu par"
          value={receiver}
          onValueChange={setReceiver}
          layout="scroll"
          options={[
            { value: me.userId, label: "Moi", leading: <Avatar name={me.displayName} size="sm" tone={toneForMember(ids, me.userId).key} className="-ml-2" decorative /> },
            ...(partner ? [{ value: partner.userId, label: partner.displayName, leading: <Avatar name={partner.displayName} size="sm" tone={toneForMember(ids, partner.userId).key} className="-ml-2" decorative /> }] : []),
            { value: "commun", label: joint.name || "Compte commun", leading: <Avatar name="Compte commun" size="sm" tone="joint" className="-ml-2" decorative /> },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <DateInput value={date} onValueChange={(v) => setDate(v || session.today)} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Facultatif" maxLength={500} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Enregistrer le remboursement
        </Button>
      </SheetFooter>
    </form>
  );
}
