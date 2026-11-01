"use client";

import { Plus } from "lucide-react";
import { Button, EmptyState, ListGroup, Money, Row, SkeletonText } from "@/components/ui";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { listKindLabel } from "./shared";

/** All lists: name, what's left to buy, estimated remaining. */
export function ListsNav({
  selectedId,
  compact = false,
  onCreate,
}: {
  selectedId?: string | null;
  compact?: boolean;
  onCreate: () => void;
}) {
  const lists = useOp("shopping.lists", {});

  if (lists.isPending) {
    return (
      <ListGroup aria-label="Chargement des listes">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex min-h-[60px] flex-col justify-center gap-1 px-4 py-2.5">
            <SkeletonText className="w-32" />
            <SkeletonText size="sm" className="w-48" />
          </div>
        ))}
      </ListGroup>
    );
  }
  if (lists.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-base text-fg-muted">
        <p>{lists.error.message}</p>
        <Button size="sm" onClick={() => lists.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (lists.data.lists.length === 0) {
    return (
      <EmptyState
        message="Aucune liste pour l'instant. Commence par l'épicerie."
        action={
          <Button variant="primary" onClick={onCreate}>
            <Plus aria-hidden />
            Nouvelle liste
          </Button>
        }
      />
    );
  }

  return (
    <nav aria-label="Listes">
      <ListGroup as="ul">
        {lists.data.lists.map((l) => {
          const active = l.id === selectedId;
          const preview = l.preview.length ? l.preview.join(", ") : l.purchasedCount ? "Tout est acheté" : "Rien à acheter pour l'instant";
          const kind = listKindLabel(l.kind);
          return (
            <li key={l.id}>
              <Row
                href={`/listes/${l.id}`}
                className={cn(active && "lg:bg-surface-2")}
                chevron={!compact}
                title={
                  <span className="flex items-baseline gap-2">
                    <span className={cn("truncate", active && "lg:font-medium")}>{l.name}</span>
                    {kind !== l.name ? <span className="shrink-0 text-sm text-fg-subtle lg:hidden">{kind}</span> : null}
                  </span>
                }
                description={l.openCount > 0 ? `${l.openCount} à acheter · ${preview}` : preview}
                trailing={l.remainingCents > 0 ? <Money cents={l.remainingCents} className="text-base text-fg-muted" /> : null}
              />
            </li>
          );
        })}
      </ListGroup>
    </nav>
  );
}
