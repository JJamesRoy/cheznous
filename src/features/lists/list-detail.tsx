"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { Archive, ChevronDown, ChevronLeft, Ellipsis, Pencil, Plus } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ListGroup,
  Money,
  Skeleton,
  SkeletonText,
  toast,
  undoable,
} from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { ApiError, callOp } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { AddItemInput, type AddItemInputHandle } from "./add-item-input";
import { ItemRow } from "./item-row";
import { ItemSheet } from "./item-sheet";
import { ListSheet } from "./list-sheet";
import { toggleItem, useListItems, type ViewItem } from "./pending-store";
import { PurchaseSheet } from "./purchase-sheet";
import { listKindLabel, type ShoppingItem } from "./shared";

const rowMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;

/**
 * One shopping list: quick one-line entry, items to buy, purchased section, totals.
 * `header="page"` owns the page title (mobile + desktop h1); `"pane"` is the right pane of /listes on desktop.
 */
export function ListDetail({ id, header }: { id: string; header: "page" | "pane" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useOp("shopping.list", { list: id });
  const view = useListItems(q.data?.list.id ?? id, q.data?.items, q.dataUpdatedAt);
  const inputRef = useRef<AddItemInputHandle>(null);

  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [buying, setBuying] = useState<ShoppingItem | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [showPurchased, setShowPurchased] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const clear = useOpMutation("shopping.clearPurchased", {
    onError: (e) => toast.error(e.message),
  });
  const archive = useOpMutation("shopping.upsertList", {
    onError: (e) => toast.error(e.message),
  });

  const list = q.data?.list;
  const totals = q.data?.totals;

  function onToggle(item: ViewItem, purchased: boolean) {
    toggleItem(qc, item.id, purchased).catch((e: unknown) => toast.error(e instanceof ApiError ? e.message : "Impossible de mettre à jour l'article."));
  }

  async function onDelete(item: ShoppingItem) {
    setEditOpen(false);
    try {
      const r = await callOp("shopping.deleteItem", { id: item.id });
      await qc.invalidateQueries({ queryKey: ["op"] });
      const d = r.deleted;
      undoable(`« ${d.name} » supprimé`, async () => {
        try {
          await callOp("shopping.addItem", {
            list: d.listId,
            clientId: d.id,
            name: d.name,
            quantity: d.quantity,
            unitPrice: d.unitPriceCents === null ? undefined : { cents: d.unitPriceCents },
            url: d.url,
            imageUrl: d.imageUrl,
            category: d.category,
            priority: d.priority,
            assignee: d.assignee?.userId ?? null,
            notes: d.notes,
          });
          if (d.purchased) await callOp("shopping.toggleItem", { id: d.id, purchased: true });
          await qc.invalidateQueries({ queryKey: ["op"] });
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Impossible de restaurer l'article.");
        }
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Impossible de supprimer l'article.");
    }
  }

  function onPurchase(item: ShoppingItem) {
    setEditOpen(false);
    setBuying(item);
    setBuyOpen(true);
  }

  function onOpen(item: ShoppingItem) {
    setEditing(item);
    setEditOpen(true);
  }

  function onArchive() {
    if (!list) return;
    archive.mutate(
      { id: list.id, name: list.name, kind: list.kind as "custom", archived: true },
      {
        onSuccess: () => {
          if (header === "page") router.push("/listes");
          undoable(`Liste « ${list.name} » archivée`, () =>
            callOp("shopping.upsertList", { id: list.id, name: list.name, kind: list.kind as "custom", archived: false }).then(() =>
              qc.invalidateQueries({ queryKey: ["op"] }),
            ),
          );
        },
      },
    );
  }

  const menu = list ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Options de la liste" variant="ghost">
          <Ellipsis aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setRenameOpen(true)}>
          Modifier la liste
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Archive aria-hidden />} onSelect={onArchive}>
          Archiver la liste
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const kindLabel = list ? listKindLabel(list.kind) : "";
  const description = list
    ? [kindLabel !== list.name ? kindLabel : null, view.open.length ? `${view.open.length} à acheter` : "Rien à acheter"].filter(Boolean).join(" · ")
    : undefined;

  if (q.error) {
    const missing = q.error.code === "NOT_FOUND";
    return (
      <div className="flex flex-col gap-4">
        {header === "page" ? <PageHeader title="Liste" /> : null}
        <div role="alert" className="flex flex-col items-start gap-3 text-base text-fg-muted">
          <p>{missing ? "Cette liste n'existe plus ou a été archivée." : q.error.message}</p>
          {missing ? (
            <Button size="sm" asChild>
              <Link href="/listes">Voir les listes</Link>
            </Button>
          ) : (
            <Button size="sm" onClick={() => q.refetch()}>
              Réessayer
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header === "page" ? (
        <>
          <Link
            href="/listes"
            className="-mt-1 -ml-1 inline-flex h-9 items-center gap-1 self-start rounded-control pr-2 text-base text-fg-muted hover:text-fg lg:hidden"
          >
            <ChevronLeft className="size-4" aria-hidden />
            Toutes les listes
          </Link>
          <PageHeader title={list?.name ?? "Liste"} description={description} actions={menu} className="pb-0" />
        </>
      ) : (
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            {list ? <h2 className="truncate text-lg font-semibold">{list.name}</h2> : <SkeletonText size="lg" className="w-40" />}
            {description ? <p className="text-sm text-fg-subtle">{description}</p> : null}
          </div>
          {menu}
        </div>
      )}

      <AddItemInput ref={inputRef} listId={list?.id ?? null} listName={list?.name} />

      {q.isPending ? (
        <ListGroup aria-label="Chargement des articles">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex min-h-[52px] items-center gap-3 px-4">
              <Skeleton shape="circle" className="size-5" />
              <SkeletonText className="w-40" />
            </div>
          ))}
        </ListGroup>
      ) : view.open.length === 0 ? (
        <EmptyState
          message={view.purchased.length ? "Tout est acheté. Bien joué." : "Rien à acheter pour l'instant."}
          action={
            <Button onClick={() => inputRef.current?.focus()}>
              <Plus aria-hidden />
              Ajouter un article
            </Button>
          }
        />
      ) : (
        <ListGroup as="ul" aria-label="À acheter">
          <AnimatePresence initial={false}>
            {view.open.map((item) => (
              <m.li key={item.id} {...rowMotion}>
                <ItemRow item={item} onToggle={onToggle} onOpen={onOpen} onDelete={onDelete} onPurchase={onPurchase} />
              </m.li>
            ))}
          </AnimatePresence>
        </ListGroup>
      )}

      {view.purchased.length > 0 ? (
        <section aria-label="Achetés" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowPurchased((v) => !v)}
              aria-expanded={showPurchased}
              className="-ml-1 inline-flex h-11 items-center gap-1.5 rounded-control px-1 text-base font-medium text-fg-muted hover:text-fg md:h-9"
            >
              <ChevronDown className={cn("size-4 transition-transform duration-150", !showPurchased && "-rotate-90")} aria-hidden />
              Achetés ({view.purchased.length})
            </button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} className="text-fg-muted">
              Vider
            </Button>
          </div>
          {showPurchased ? (
            <ListGroup as="ul" aria-label="Articles achetés">
              <AnimatePresence initial={false}>
                {view.purchased.map((item) => (
                  <m.li key={item.id} {...rowMotion}>
                    <ItemRow item={item} onToggle={onToggle} onOpen={onOpen} onDelete={onDelete} onPurchase={onPurchase} />
                  </m.li>
                ))}
              </AnimatePresence>
            </ListGroup>
          ) : null}
        </section>
      ) : null}

      {totals && (q.data?.items.length ?? 0) > 0 ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-fg-subtle">Estimé restant</dt>
            <dd className="text-md font-medium text-fg">
              <Money cents={totals.estimatedRemainingCents} animate />
            </dd>
            {totals.unpricedCount > 0 ? (
              <dd className="text-sm text-fg-subtle">
                {totals.unpricedCount} article{totals.unpricedCount > 1 ? "s" : ""} sans prix
              </dd>
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-fg-subtle">Dépensé (réel)</dt>
            <dd className="text-md font-medium text-fg">
              <Money cents={totals.actualSpentCents} animate />
            </dd>
          </div>
        </dl>
      ) : null}

      <ItemSheet item={editing} open={editOpen} onOpenChange={setEditOpen} onPurchase={onPurchase} onDelete={onDelete} />
      <PurchaseSheet item={buying} open={buyOpen} onOpenChange={setBuyOpen} />
      <ListSheet open={renameOpen} onOpenChange={setRenameOpen} list={list ?? null} />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Vider les articles achetés ?"
        description={`${view.purchased.length} article${view.purchased.length > 1 ? "s" : ""} seront retirés de la liste. Les dépenses déjà ajoutées sont conservées.`}
        confirmLabel="Vider"
        destructive
        onConfirm={async () => {
          if (list) await clear.mutateAsync({ list: list.id }).catch(() => undefined);
        }}
      />
    </div>
  );
}
