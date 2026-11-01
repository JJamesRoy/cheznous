"use client";

import { useState } from "react";
import { Receipt, Trash2 } from "lucide-react";
import {
  AssigneePicker,
  Button,
  Field,
  Input,
  MoneyInput,
  SegmentedControl,
  Select,
  Sheet,
  SheetFooter,
  Textarea,
} from "@/components/ui";
import { useOpMutation } from "@/lib/data/query";
import { useMembers, useSession } from "@/features/app/session";
import { centsToInput, PRIORITY_LABELS, type ShoppingItem } from "./shared";

type Props = {
  item: ShoppingItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
};

/** Detail / edit sheet for one list item. */
export function ItemSheet({ item, open, onOpenChange, onPurchase, onDelete }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Article" desktop="panel">
      {item ? <ItemForm key={item.id} item={item} onDone={() => onOpenChange(false)} onPurchase={onPurchase} onDelete={onDelete} /> : null}
    </Sheet>
  );
}

function normalizeUrl(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function ItemForm({
  item,
  onDone,
  onPurchase,
  onDelete,
}: {
  item: ShoppingItem;
  onDone: () => void;
  onPurchase: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
}) {
  const session = useSession();
  const { members } = useMembers();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(String(item.quantity).replace(".", ","));
  const [price, setPrice] = useState(centsToInput(item.unitPriceCents));
  const [priceCents, setPriceCents] = useState<number | null>(item.unitPriceCents);
  const [priority, setPriority] = useState<"0" | "1" | "2">(String(item.priority) as "0" | "1" | "2");
  const [assignee, setAssignee] = useState<string | null>(item.assignee?.userId ?? null);
  const [listId, setListId] = useState(item.listId);
  const [category, setCategory] = useState(item.category ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const update = useOpMutation("shopping.updateItem", {
    onSuccess: () => onDone(),
    onError: (e) => setError(e.message),
  });

  const qty = Number(quantity.replace(",", ".").trim());
  const qtyInvalid = !Number.isFinite(qty) || qty <= 0 || qty > 999;
  const priceInvalid = price.trim() !== "" && priceCents === null;
  const imagePreview = normalizeUrl(imageUrl);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || qtyInvalid || priceInvalid) return;
    setError(null);
    update.mutate({
      id: item.id,
      name: name.trim(),
      quantity: Math.round(qty * 100) / 100,
      unitPrice: priceCents === null ? null : { cents: priceCents },
      priority: Number(priority) as 0 | 1 | 2,
      assignee,
      list: listId !== item.listId ? listId : undefined,
      category: category.trim() || null,
      url: normalizeUrl(url),
      imageUrl: imagePreview,
      notes: notes.trim() || null,
    });
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <Field label="Nom" error={!name.trim() ? "Nomme l'article." : undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantité" error={qtyInvalid ? "Entre 0,01 et 999." : undefined}>
          <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className="num" autoComplete="off" />
        </Field>
        <Field label="Prix unitaire" error={priceInvalid ? "Montant invalide." : undefined}>
          <MoneyInput
            value={price}
            onValueChange={(text, cents) => {
              setPrice(text);
              setPriceCents(cents);
            }}
            placeholder="—"
          />
        </Field>
      </div>
      <Field label="Priorité">
        <SegmentedControl
          aria-label="Priorité"
          value={priority}
          onValueChange={setPriority}
          options={([0, 1, 2] as const).map((p) => ({ value: String(p) as "0" | "1" | "2", label: PRIORITY_LABELS[p] }))}
        />
      </Field>
      <Field label="Liste">
        <Select value={listId} onValueChange={setListId} options={session.lists.map((l) => ({ value: l.id, label: l.name }))} />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">Qui s&apos;en occupe</span>
        <AssigneePicker
          people={members.map((m, i) => ({
            id: m.userId,
            name: m.isMe ? `${m.displayName} (moi)` : m.displayName,
            tone: i === 0 ? ("a" as const) : i === 1 ? ("b" as const) : ("neutral" as const),
          }))}
          value={assignee}
          onValueChange={setAssignee}
          showName
          label="Qui s'en occupe"
        />
      </div>
      <Field label="Catégorie" hint="Ex. : produits laitiers, salon">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} autoComplete="off" />
      </Field>
      <Field label="Lien">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" placeholder="https://" autoComplete="off" />
      </Field>
      <Field label="Image (lien)">
        <div className="flex items-center gap-3">
          <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} type="url" inputMode="url" placeholder="https://" autoComplete="off" />
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt={`Image de ${name}`} className="size-11 shrink-0 rounded-control bg-surface-2 object-cover md:size-9" />
          ) : null}
        </div>
      </Field>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
      </Field>

      {!item.expenseId ? (
        <Button type="button" variant="secondary" onClick={() => onPurchase(item)}>
          <Receipt aria-hidden />
          Marquer acheté et ajouter la dépense
        </Button>
      ) : (
        <p className="text-sm text-fg-subtle">La dépense de cet achat est déjà enregistrée.</p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}

      <SheetFooter>
        <Button type="button" variant="danger-ghost" onClick={() => onDelete(item)} className="md:mr-auto">
          <Trash2 aria-hidden />
          Supprimer
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending} disabled={!name.trim() || qtyInvalid || priceInvalid}>
          Enregistrer
        </Button>
      </SheetFooter>
    </form>
  );
}
