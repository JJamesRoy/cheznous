"use client";

import { Archive, ArchiveRestore, ChevronDown, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Sheet,
  SheetFooter,
  Skeleton,
  toast,
  undoable,
} from "@/components/ui";
import { useOp, useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { cn } from "@/lib/ui/cn";
import { InlineError, Panel, SettingsSection } from "./section";

type Kind = "fixed" | "variable";
type Category = { id: string; name: string; kind: string; sort: number; archived: boolean };

const KIND_LABEL: Record<Kind, string> = { fixed: "Fixe", variable: "Variable" };

export function CategoriesSection() {
  const list = useOp("categories.list", { includeArchived: true });
  const upsert = useOpMutation("categories.upsert");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = list.data?.categories.filter((c) => !c.archived) ?? [];
  const archived = list.data?.categories.filter((c) => c.archived) ?? [];

  function setArchived(c: Category, value: boolean) {
    upsert.mutate(
      { id: c.id, name: c.name, kind: c.kind as Kind, archived: value },
      {
        onSuccess: () => {
          if (value) undoable(`« ${c.name} » archivée`, () => upsert.mutate({ id: c.id, name: c.name, kind: c.kind as Kind, archived: false }));
          else toast(`« ${c.name} » réactivée`);
        },
        onError: (e) => toast(e.message),
      },
    );
  }

  return (
    <SettingsSection
      id="categories"
      title="Catégories"
      description="Pour classer les dépenses et le budget. Fixe : revient chaque mois (frais de condo, hypothèque). Variable : épicerie, sorties…"
    >
      <Panel padded={false}>
        {list.isPending ? (
          <div aria-busy>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex h-[52px] items-center gap-3 px-4 md:px-5 [&+&]:border-t [&+&]:border-border">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        ) : list.error ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-4 md:p-5">
            <p className="text-base text-fg-muted">{list.error.message}</p>
            <Button variant="secondary" size="sm" onClick={() => list.refetch()}>
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            {active.length === 0 ? (
              <p className="p-4 text-base text-fg-muted md:p-5">Aucune catégorie active. Ajoute la première.</p>
            ) : (
              <ul>
                {active.map((c) => (
                  <CategoryRow key={c.id} category={c} onEdit={() => setEditing(c)} onArchive={() => setArchived(c, true)} />
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-2 md:px-3">
              <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                Ajouter une catégorie
              </Button>
              {archived.length ? (
                <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)} className="text-fg-muted">
                  <span className="num">Archivées ({archived.length})</span>
                  <ChevronDown aria-hidden className={cn("transition-transform duration-150", showArchived && "rotate-180")} />
                </Button>
              ) : null}
            </div>
            {showArchived && archived.length ? (
              <ul className="border-t border-border">
                {archived.map((c) => (
                  <CategoryRow key={c.id} category={c} onEdit={() => setEditing(c)} onArchive={() => setArchived(c, false)} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Panel>
      <CategorySheet editing={editing} onClose={() => setEditing(null)} />
    </SettingsSection>
  );
}

function CategoryRow({ category, onEdit, onArchive }: { category: Category; onEdit: () => void; onArchive: () => void }) {
  return (
    <li className="flex min-h-[52px] items-center gap-3 pr-2 pl-4 md:pl-5 [&+&]:border-t [&+&]:border-border">
      <button type="button" onClick={onEdit} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 text-left">
        <span className={cn("min-w-0 flex-1 truncate text-base", category.archived ? "text-fg-subtle" : "text-fg")}>{category.name}</span>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">{KIND_LABEL[category.kind as Kind] ?? category.kind}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions pour ${category.name}`} size="icon">
            <MoreHorizontal aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={onEdit}>
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem icon={category.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} onSelect={onArchive}>
            {category.archived ? "Réactiver" : "Archiver"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function CategorySheet({ editing, onClose }: { editing: Category | "new" | null; onClose: () => void }) {
  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(o) => !o && onClose()}
      title={editing === "new" ? "Nouvelle catégorie" : "Modifier la catégorie"}
      description={editing && editing !== "new" && editing.archived ? "Cette catégorie est archivée." : undefined}
    >
      {editing ? <CategoryForm key={editing === "new" ? "new" : editing.id} category={editing === "new" ? null : editing} onDone={onClose} /> : null}
    </Sheet>
  );
}

function CategoryForm({ category, onDone }: { category: Category | null; onDone: () => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<Kind>((category?.kind as Kind) ?? "variable");
  const [error, setError] = useState<string | null>(null);
  const upsert = useOpMutation("categories.upsert", {
    onSuccess: () => {
      haptic("success");
      toast(category ? "Catégorie modifiée" : `« ${name.trim()} » ajoutée`);
      onDone();
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Donne un nom à la catégorie.");
        setError(null);
        upsert.mutate({ id: category?.id, name: name.trim(), kind, archived: category?.archived });
      }}
      className="flex flex-col gap-4"
    >
      <Field label="Nom" error={error ?? undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Épicerie" />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Type</span>
        <SegmentedControl
          aria-label="Type de catégorie"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "variable", label: "Variable" },
            { value: "fixed", label: "Fixe" },
          ]}
        />
        <p className="text-sm text-fg-subtle">
          {kind === "fixed" ? "Revient chaque mois, à peu près au même montant." : "Change d'un mois à l'autre."}
        </p>
      </div>
      {upsert.error ? <InlineError>{upsert.error.message}</InlineError> : null}
      <SheetFooter>
        <Button onClick={onDone}>Annuler</Button>
        <Button type="submit" variant="primary" loading={upsert.isPending}>
          {category ? "Enregistrer" : "Ajouter"}
        </Button>
      </SheetFooter>
    </form>
  );
}
