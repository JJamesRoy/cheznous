"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, CloudUpload } from "lucide-react";
import { Button, Field, Select, Sheet, SheetFooter } from "@/components/ui";
import type { QuickAddSheetProps } from "@/features/app/quick-add-sheets";
import { useSession } from "@/features/app/session";
import { AddItemInput } from "./add-item-input";
import { defaultListId } from "./shared";

/** Quick add from anywhere (+, ⌘K): pick a list, type lines one after another. */
export function QuickAddItem({ open, onOpenChange, prefill }: QuickAddSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ajouter à une liste">
      {open ? <QuickAddItemForm prefill={prefill} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function QuickAddItemForm({ prefill, onDone }: { prefill?: Record<string, unknown>; onDone: () => void }) {
  const session = useSession();
  const pathname = usePathname();
  const fromPath = /^\/listes\/([0-9a-f-]{36})/.exec(pathname)?.[1];
  const initial =
    (typeof prefill?.listId === "string" && session.lists.some((l) => l.id === prefill.listId) ? (prefill.listId as string) : null) ??
    (fromPath && session.lists.some((l) => l.id === fromPath) ? fromPath : null) ??
    defaultListId(session.lists);
  const [listId, setListId] = useState<string | null>(initial);
  const [added, setAdded] = useState<{ line: string; queued: boolean; n: number }[]>([]);
  const list = session.lists.find((l) => l.id === listId);

  if (session.lists.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 pb-2">
        <p className="text-base text-fg-muted">Crée d&apos;abord une liste, comme l&apos;épicerie.</p>
        <Button variant="primary" asChild onClick={onDone}>
          <Link href="/listes">Créer une liste</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Liste">
        <Select value={listId ?? undefined} onValueChange={setListId} options={session.lists.map((l) => ({ value: l.id, label: l.name }))} />
      </Field>
      <Field label="Article" hint="Une ligne par article. Quantité et prix sont reconnus : « 2 lait 3,99 ».">
        <AddItemInput
          key={listId}
          listId={listId}
          listName={list?.name}
          autoFocus
          onAdded={(line, queued) => setAdded((cur) => [{ line, queued, n: (cur[0]?.n ?? 0) + 1 }, ...cur].slice(0, 4))}
        />
      </Field>
      <ul aria-live="polite" aria-label="Articles ajoutés" className="flex min-h-5 flex-col gap-1">
        {added.map((a) => (
          <li key={a.n} className="flex items-center gap-2 text-sm text-fg-muted">
            {a.queued ? <CloudUpload className="size-4 shrink-0" aria-hidden /> : <Check className="size-4 shrink-0 text-accent" aria-hidden />}
            <span className="truncate">
              Ajouté : {a.line}
              {a.queued ? " · en attente de synchronisation" : ""}
            </span>
          </li>
        ))}
      </ul>
      <SheetFooter>
        {listId ? (
          <Button asChild onClick={onDone}>
            <Link href={`/listes/${listId}`}>Voir la liste</Link>
          </Button>
        ) : null}
        <Button variant="primary" onClick={onDone}>
          Terminé
        </Button>
      </SheetFooter>
    </div>
  );
}
