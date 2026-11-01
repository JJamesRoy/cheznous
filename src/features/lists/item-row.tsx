"use client";

import { Check, CloudUpload, Link2, Receipt, RotateCcw, Trash2 } from "lucide-react";
import { Checkbox, Money, SwipeRow, type SwipeAction } from "@/components/ui";
import { MetaLine } from "./meta-line";
import { PersonAvatar } from "./person-avatar";
import { cn } from "@/lib/ui/cn";
import type { ViewItem } from "./pending-store";
import { formatQuantity, PRIORITY_LABELS } from "./shared";

export function ItemRow({
  item,
  onToggle,
  onOpen,
  onDelete,
  onPurchase,
}: {
  item: ViewItem;
  onToggle: (item: ViewItem, purchased: boolean) => void;
  onOpen: (item: ViewItem) => void;
  onDelete: (item: ViewItem) => void;
  onPurchase: (item: ViewItem) => void;
}) {
  const saving = item.sync === "saving";
  const pending = item.sync !== null;
  const canExpense = !pending && !item.expenseId;

  const leading: SwipeAction[] = pending && saving
    ? []
    : [
        item.purchased
          ? { id: "unbuy", label: "Remettre", icon: <RotateCcw aria-hidden />, tone: "neutral", onAction: () => onToggle(item, false) }
          : { id: "buy", label: "Acheté", icon: <Check aria-hidden />, tone: "accent", onAction: () => onToggle(item, true) },
      ];
  const trailing: SwipeAction[] = pending
    ? []
    : [
        { id: "delete", label: "Supprimer", icon: <Trash2 aria-hidden />, tone: "danger", onAction: () => onDelete(item) },
        ...(canExpense
          ? [{ id: "expense", label: "Dépense", icon: <Receipt aria-hidden />, tone: "neutral" as const, onAction: () => onPurchase(item) }]
          : []),
      ];

  const meta: React.ReactNode[] = [];
  if (item.priority > 0) {
    meta.push(
      <span key="p" className={cn("font-medium", item.priority === 2 ? "text-fg" : "text-fg-muted")}>
        {PRIORITY_LABELS[item.priority]}
      </span>,
    );
  }
  if (item.unitPriceCents !== null && item.quantity !== 1) {
    meta.push(
      <span key="u">
        <Money cents={item.unitPriceCents} /> ch.
      </span>,
    );
  }
  if (item.category) meta.push(<span key="c">{item.category}</span>);
  if (item.purchased && item.purchasedBy && !pending) meta.push(<span key="b">par {item.purchasedBy.name}</span>);
  if (item.expenseId) meta.push(<span key="e">Dépense ajoutée</span>);
  if (item.sync === "queued") {
    meta.push(
      <span key="s" className="inline-flex items-center gap-1 text-fg-muted">
        <CloudUpload className="size-3.5" aria-hidden />
        en attente de synchronisation
      </span>,
    );
  }

  return (
    <SwipeRow leadingActions={leading} trailingActions={trailing}>
      <div className={cn("flex min-h-[52px] items-center gap-3 pl-4", saving && "opacity-70")} data-testid="item-row" data-item-id={item.id}>
        <Checkbox
          shape="round"
          checked={item.purchased}
          disabled={saving}
          onCheckedChange={(next) => onToggle(item, next)}
          aria-label={item.purchased ? `Remettre ${item.name} à acheter` : `Marquer ${item.name} comme acheté`}
        />
        <div className="cn-row-sep relative flex min-w-0 flex-1 items-center gap-2 self-stretch pr-2">
          <button
            type="button"
            onClick={() => onOpen(item)}
            disabled={pending}
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2.5 text-left focus-visible:-outline-offset-2 disabled:cursor-default"
            aria-label={`Modifier ${item.name}`}
          >
            {item.imageUrl ? (
              // External product photo: no optimizer domain to configure for arbitrary shops.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt="" className="size-9 shrink-0 rounded-control border border-border object-cover" loading="lazy" />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("truncate text-base text-fg", item.purchased && "text-fg-subtle line-through decoration-fg-subtle")}>
                {item.quantity !== 1 ? <span className="num text-fg-muted">{formatQuantity(item.quantity)} × </span> : null}
                {item.name}
              </span>
              <MetaLine items={meta} />
            </span>
            {item.totalCents !== null ? (
              <Money cents={item.totalCents} className={cn("shrink-0 text-base", item.purchased ? "text-fg-subtle" : "text-fg")} />
            ) : null}
          </button>
          {item.assignee ? <PersonAvatar userId={item.assignee.userId} name={item.assignee.name} className="shrink-0" /> : null}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ouvrir le lien de ${item.name}`}
              className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <Link2 className="size-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </SwipeRow>
  );
}
