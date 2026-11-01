"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ChipGroup, Field, Input, Sheet, SheetFooter } from "@/components/ui";
import { useOpMutation } from "@/lib/data/query";
import { LIST_KIND_LABELS, LIST_KIND_OPTIONS, type ListKind } from "./shared";

type Existing = { id: string; name: string; kind: string };

/** Create a list (then open it) or rename / re-kind an existing one. */
export function ListSheet({ open, onOpenChange, list }: { open: boolean; onOpenChange: (open: boolean) => void; list?: Existing | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={list ? "Modifier la liste" : "Nouvelle liste"}>
      {open ? <ListForm key={list?.id ?? "new"} list={list ?? null} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function ListForm({ list, onDone }: { list: Existing | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(list?.name ?? "");
  const [kind, setKind] = useState<ListKind>((list?.kind as ListKind) ?? "groceries");
  const [touchedName, setTouchedName] = useState(!!list);
  const [error, setError] = useState<string | null>(null);

  const upsert = useOpMutation("shopping.upsertList", {
    onSuccess: (r) => {
      onDone();
      if (!list) router.push(`/listes/${r.id}`);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setError(null);
        upsert.mutate({ id: list?.id, name: name.trim(), kind });
      }}
    >
      <Field label="Nom">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setTouchedName(true);
          }}
          maxLength={60}
          autoFocus
          autoComplete="off"
          placeholder="Ex. : Épicerie, Chambre d'amis"
        />
      </Field>
      <Field label="Type">
        <ChipGroup
          aria-label="Type de liste"
          value={kind}
          onValueChange={(k) => {
            setKind(k);
            // Suggest the kind's name until the person types their own.
            if (!touchedName || Object.values(LIST_KIND_LABELS).includes(name)) setName(k === "custom" ? "" : LIST_KIND_LABELS[k]);
          }}
          options={LIST_KIND_OPTIONS}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={upsert.isPending} disabled={!name.trim()}>
          {list ? "Enregistrer" : "Créer la liste"}
        </Button>
      </SheetFooter>
    </form>
  );
}
