"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Pin, Plus, Search, X } from "lucide-react";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  Input,
  ListGroup,
  PullToRefresh,
  SectionHeader,
  SkeletonText,
} from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { useQuickAdd } from "@/features/app/quick-add";
import { useSession } from "@/features/app/session";
import { Snippet, updatedLabel } from "./shared";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type NoteLine = {
  id: string;
  title: string;
  text: React.ReactNode;
  pinned: boolean;
  isPrivate: boolean;
  meta: string;
};

function NoteRow({ note }: { note: NoteLine }) {
  return (
    <li>
      <Link
        href={`/notes/${note.id}`}
        className="group/row pressable relative flex w-full flex-col gap-0.5 bg-surface px-4 py-3 text-left hover:bg-surface-2 focus-visible:-outline-offset-2"
      >
        <span className="cn-row-sep pointer-events-none absolute inset-x-4 top-0" aria-hidden />
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-base font-medium text-fg">{note.title}</span>
          {note.pinned ? <Pin className="size-3.5 shrink-0 text-fg-subtle" aria-label="Épinglée" /> : null}
          {note.isPrivate ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm text-fg-subtle">
              <Lock className="size-3.5" aria-hidden />
              Privé
            </span>
          ) : null}
        </span>
        {note.text ? <span className="line-clamp-2 text-sm text-fg-muted">{note.text}</span> : null}
        <span className="text-sm text-fg-subtle">{note.meta}</span>
      </Link>
    </li>
  );
}

export function NotesScreen() {
  const qc = useQueryClient();
  const { today, household } = useSession();
  const quickAdd = useQuickAdd();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const q = useDebounced(query.trim(), 250);

  const all = useOp("notes.list", {});
  const filtered = useOp("notes.list", { tag: tag ?? undefined }, { enabled: !!tag });
  const search = useOp("notes.search", { q }, { enabled: q.length > 0, placeholderData: (prev) => prev });

  const tags = [...new Set((all.data?.notes ?? []).flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b, "fr"));
  const source = tag ? filtered : all;
  const searching = q.length > 0;

  const newNote = () => quickAdd.open("note");

  let body: React.ReactNode;
  if (searching) {
    if (search.error) {
      body = <ErrorLine message={search.error.message} onRetry={() => search.refetch()} />;
    } else if (!search.data) {
      body = <RowsSkeleton />;
    } else {
      const results = search.data.results.filter((r) => !tag || source.data?.notes.some((n) => n.id === r.id));
      body = results.length ? (
        <ListGroup as="ul" aria-label="Résultats" className={cn(search.isFetching && "opacity-70 transition-opacity")}>
          {results.map((r) => (
            <NoteRow
              key={r.id}
              note={{
                id: r.id,
                title: r.title,
                text: <Snippet text={r.snippet} />,
                pinned: r.pinned,
                isPrivate: r.isPrivate,
                meta: `Modifiée ${updatedLabel(r.updatedAt, household.timezone, today)}`,
              }}
            />
          ))}
        </ListGroup>
      ) : (
        <EmptyState
          message={`Aucune note ne contient « ${q} ».`}
          action={
            <Button onClick={() => setQuery("")}>
              Effacer la recherche
            </Button>
          }
        />
      );
    }
  } else if (source.error) {
    body = <ErrorLine message={source.error.message} onRetry={() => source.refetch()} />;
  } else if (!source.data) {
    body = <RowsSkeleton />;
  } else if (source.data.notes.length === 0) {
    body = (
      <EmptyState
        message="Aucune note pour l'instant. Codes d'accès, contacts du syndicat, idées : tout au même endroit."
        action={
          <Button variant="primary" onClick={newNote}>
            <Plus aria-hidden />
            Nouvelle note
          </Button>
        }
      />
    );
  } else {
    const notes = source.data.notes;
    const pinned = notes.filter((n) => n.pinned);
    const others = notes.filter((n) => !n.pinned);
    const toLine = (n: (typeof notes)[number]): NoteLine => ({
      id: n.id,
      title: n.title,
      text: n.excerpt,
      pinned: false,
      isPrivate: n.isPrivate,
      meta: `${n.author.isMe ? "Toi" : n.author.name} · ${updatedLabel(n.updatedAt, household.timezone, today)}`,
    });
    body = (
      <div className="flex flex-col gap-5">
        {pinned.length ? (
          <section className="flex flex-col gap-2" aria-label="Épinglées">
            <SectionHeader title="Épinglées" />
            <ListGroup as="ul">{pinned.map((n) => <NoteRow key={n.id} note={toLine(n)} />)}</ListGroup>
          </section>
        ) : null}
        {others.length ? (
          <section className="flex flex-col gap-2" aria-label="Notes">
            {pinned.length ? <SectionHeader title="Autres notes" /> : null}
            <ListGroup as="ul">{others.map((n) => <NoteRow key={n.id} note={toLine(n)} />)}</ListGroup>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["op"] })}>
      <PageHeader
        title="Notes"
        actions={
          <>
            <IconButton label="Nouvelle note" onClick={newNote} className="lg:hidden">
              <Plus aria-hidden />
            </IconButton>
            <Button onClick={newNote} className="hidden lg:inline-flex">
              <Plus aria-hidden />
              Nouvelle note
            </Button>
          </>
        }
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-4 lg:mx-0">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans les notes"
          aria-label="Rechercher dans les notes"
          leading={<Search aria-hidden />}
          trailing={
            query ? (
              <IconButton label="Effacer la recherche" size="icon-sm" onClick={() => setQuery("")}>
                <X aria-hidden />
              </IconButton>
            ) : undefined
          }
          enterKeyHint="search"
          autoComplete="off"
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        {tags.length ? (
          <div role="group" aria-label="Filtrer par étiquette" className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
            <Chip pressed={tag === null} onClick={() => setTag(null)}>
              Toutes
            </Chip>
            {tags.map((t) => (
              <Chip key={t} pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                #{t}
              </Chip>
            ))}
          </div>
        ) : null}
        {body}
      </div>
    </PullToRefresh>
  );
}

function RowsSkeleton() {
  return (
    <ListGroup aria-label="Chargement des notes">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1 px-4 py-3">
          <SkeletonText className="w-40" />
          <SkeletonText size="sm" className="w-full" />
          <SkeletonText size="sm" className="w-24" />
        </div>
      ))}
    </ListGroup>
  );
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-base text-fg-muted">
      <p>{message}</p>
      <Button size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
