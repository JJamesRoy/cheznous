"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ChipGroup, Field, Input, MoneyInput, Sheet, SheetFooter, toast } from "@/components/ui";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOnline, useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { useMembers } from "@/features/app/session";
import { centsToInput, type ShoppingItem } from "./shared";

/** "Marquer acheté et ajouter la dépense": confirm amount, description and payer, then shopping.purchase. */
export function PurchaseSheet({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: ShoppingItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Ajouter la dépense"
      description={item ? "L'article sera marqué acheté et la dépense ajoutée." : undefined}
    >
      {item ? (
        <PurchaseForm
          key={item.id}
          item={item}
          onDone={() => {
            onOpenChange(false);
            onDone?.();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function PurchaseForm({ item, onDone }: { item: ShoppingItem; onDone: () => void }) {
  const router = useRouter();
  const online = useOnline();
  const { me, partner, joint } = useMembers();
  const [amount, setAmount] = useState(centsToInput(item.totalCents));
  const [cents, setCents] = useState<number | null>(item.totalCents);
  const [description, setDescription] = useState(item.name);
  const [payer, setPayer] = useState<string>(me.userId);
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);

  const purchase = useOpMutation("shopping.purchase", {
    onSuccess: () => {
      haptic("success");
      toast("Dépense ajoutée", {
        description: description.trim() || item.name,
        action: { label: "Voir", onClick: () => router.push("/depenses") },
      });
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  const payers = [
    { value: me.userId, label: "Moi" },
    ...(partner ? [{ value: partner.userId, label: partner.displayName }] : []),
    { value: joint.id, label: "Compte commun" },
  ];

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!cents) return;
        setError(null);
        purchase.mutate({
          id: item.id,
          createExpense: true,
          amount: { cents },
          description: description.trim() || item.name,
          payer,
          idempotencyKey: key,
        });
      }}
    >
      <Field label="Montant payé" hideLabel>
        <MoneyInput
          size="lg"
          value={amount}
          autoFocus={!item.totalCents}
          onValueChange={(text, c) => {
            setAmount(text);
            setCents(c);
          }}
        />
      </Field>
      {item.totalCents === null ? (
        <p className="-mt-3 text-center text-sm text-fg-subtle">Aucun prix estimé : indique le montant payé.</p>
      ) : null}
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} autoComplete="off" />
      </Field>
      <Field label="Payé par">
        <ChipGroup aria-label="Payé par" value={payer} onValueChange={setPayer} options={payers} />
      </Field>
      {!online ? (
        <p role="status" className="text-sm text-fg-muted">
          Hors ligne : la dépense pourra être ajoutée quand la connexion reviendra. Tu peux quand même cocher l&apos;article.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={purchase.isPending} disabled={!cents || !online}>
          Ajouter la dépense
        </Button>
      </SheetFooter>
    </form>
  );
}
