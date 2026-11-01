"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, IconButton, PullToRefresh, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { useOp } from "@/lib/data/query";
import { ListDetail } from "./list-detail";
import { ListSheet } from "./list-sheet";
import { ListsNav } from "./lists-nav";
import { defaultListId } from "./shared";

function NewListButton({ onClick }: { onClick: () => void }) {
  return (
    <>
      <IconButton label="Nouvelle liste" onClick={onClick} className="lg:hidden">
        <Plus aria-hidden />
      </IconButton>
      <Button onClick={onClick} className="hidden lg:inline-flex">
        <Plus aria-hidden />
        Nouvelle liste
      </Button>
    </>
  );
}

/**
 * /listes and /listes/[id]. Mobile: the overview, or one list. Desktop: two panes — lists on the
 * left, the selected list (or the groceries list) on the right.
 */
export function ListsScreen({ listId }: { listId?: string }) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const lists = useOp("shopping.lists", {});
  const fallbackId = lists.data ? defaultListId(lists.data.lists) : null;
  const selected = listId ?? fallbackId;

  const refresh = () => qc.invalidateQueries({ queryKey: ["op"] });

  return (
    <PullToRefresh onRefresh={refresh}>
      {listId ? null : <PageHeader title="Listes" actions={<NewListButton onClick={() => setCreateOpen(true)} />} />}
      <div className="lg:grid lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:gap-10">
        <div className={listId ? "hidden lg:flex lg:flex-col lg:gap-3" : "flex flex-col gap-3"}>
          {listId ? (
            <div className="flex min-h-10 items-center justify-between">
              <h2 className="text-sm font-medium text-fg-muted">Toutes les listes</h2>
              <IconButton label="Nouvelle liste" size="icon-sm" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden />
              </IconButton>
            </div>
          ) : null}
          <ListsNav selectedId={selected} compact={!!listId} onCreate={() => setCreateOpen(true)} />
        </div>
        {listId ? (
          <ListDetail id={listId} header="page" />
        ) : selected ? (
          <div className="hidden lg:block">
            <ListDetail key={selected} id={selected} header="pane" />
          </div>
        ) : lists.isPending ? (
          <div className="hidden flex-col gap-5 lg:flex" aria-hidden>
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton shape="card" className="h-52 w-full" />
          </div>
        ) : null}
      </div>
      <ListSheet open={createOpen} onOpenChange={setCreateOpen} />
    </PullToRefresh>
  );
}
