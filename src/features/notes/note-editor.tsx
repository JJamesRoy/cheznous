"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, FileText, Lock, Pin, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  Switch,
  Textarea,
  toast,
} from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { ApiError, callOp, type OpOutput } from "@/lib/data/api";
import { useOp } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/features/app/session";
import { TagsEditor } from "@/features/tasks/tags-editor";
import { Markdown } from "./markdown";
import { updatedLabel } from "./shared";

type NoteData = OpOutput<"notes.get">;
type Saved = { title: string; bodyMd: string; tags: string[] };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 800;

export function NoteEditorScreen({ id }: { id: string }) {
  const q = useOp("notes.get", { id }, { staleTime: 0 });

  if (q.error) {
    const missing = q.error.code === "NOT_FOUND";
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 lg:mx-0">
        <PageHeader title="Note" />
        <div role="alert" className="flex flex-col items-start gap-3 text-base text-fg-muted">
          <p>{missing ? "Cette note n'existe plus, ou elle est privée." : q.error.message}</p>
          {missing ? (
            <Button size="sm" asChild>
              <Link href="/notes">Voir les notes</Link>
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
  if (!q.data) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 lg:mx-0" aria-busy>
        <PageHeader title="Note" />
        <SkeletonText size="lg" className="w-56" />
        <Skeleton shape="card" className="h-64 w-full" />
      </div>
    );
  }
  return <NoteEditor key={q.data.note.id} data={q.data} />;
}

function NoteEditor({ data }: { data: NoteData }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { household, today } = useSession();
  const note = data.note;
  const canChangePrivacy = note.author.isMe;

  const initialTitle = note.title === "Sans titre" ? "" : note.title;
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(note.bodyMd ?? "");
  const [tags, setTags] = useState<string[]>(note.tags);
  const [saved, setSaved] = useState<Saved>({ title: initialTitle, bodyMd: note.bodyMd ?? "", tags: note.tags });
  const [pinned, setPinned] = useState(note.pinned);
  const [isPrivate, setIsPrivate] = useState(note.isPrivate);
  const [syncedAt, setSyncedAt] = useState(note.updatedAt);
  const [mode, setMode] = useState<"edit" | "preview">(note.bodyMd ? "preview" : "edit");
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = title !== saved.title || body !== saved.bodyMd || tags.join("\n") !== saved.tags.join("\n");

  // The partner edited the note while we were idle: take their version.
  if (note.updatedAt !== syncedAt && !dirty && status !== "saving") {
    setSyncedAt(note.updatedAt);
    const t = note.title === "Sans titre" ? "" : note.title;
    setTitle(t);
    setBody(note.bodyMd ?? "");
    setTags(note.tags);
    setSaved({ title: t, bodyMd: note.bodyMd ?? "", tags: note.tags });
    setPinned(note.pinned);
    setIsPrivate(note.isPrivate);
  }

  const latest = useRef({ title, body, tags, dirty });
  const deleted = useRef(false);
  useEffect(() => {
    latest.current = { title, body, tags, dirty };
  });

  const save = useCallback(async () => {
    const cur = latest.current;
    if (!cur.dirty || deleted.current) return;
    const sent: Saved = { title: cur.title, bodyMd: cur.body, tags: cur.tags };
    setStatus("saving");
    try {
      const r = await callOp("notes.update", { id: note.id, title: sent.title, bodyMd: sent.bodyMd, tags: sent.tags });
      setSaved(sent);
      setSyncedAt(r.note.updatedAt);
      setStatus("saved");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["op", "notes.list"] });
      void qc.invalidateQueries({ queryKey: ["op", "notes.search"] });
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }, [note.id, qc]);

  // Debounced autosave.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, title, body, tags, save]);

  // Flush when leaving the page or the app.
  useEffect(() => {
    const flush = () => {
      if (latest.current.dirty) void save();
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [save]);

  async function patchFlag(patch: { pinned?: boolean; isPrivate?: boolean }) {
    try {
      const r = await callOp("notes.update", { id: note.id, ...patch });
      setSyncedAt(r.note.updatedAt);
      void qc.invalidateQueries({ queryKey: ["op", "notes.list"] });
    } catch (e) {
      if (patch.pinned !== undefined) setPinned(!patch.pinned);
      if (patch.isPrivate !== undefined) setIsPrivate(!patch.isPrivate);
      toast.error(e instanceof ApiError ? e.message : "Modification impossible.");
    }
  }

  const statusText =
    status === "saving"
      ? "Enregistrement…"
      : status === "error"
        ? null
        : dirty
          ? "Modifications non enregistrées"
          : status === "saved"
            ? "Enregistré"
            : `Modifiée ${updatedLabel(note.updatedAt, household.timezone, today)}`;

  const actions = (
    <>
      <IconButton
        label={pinned ? "Désépingler" : "Épingler"}
        aria-pressed={pinned}
        className={cn(pinned && "bg-surface-2 text-fg")}
        onClick={() => {
          setPinned(!pinned);
          void patchFlag({ pinned: !pinned });
        }}
      >
        <Pin aria-hidden className={cn(pinned && "fill-current")} />
      </IconButton>
      <IconButton label="Supprimer la note" onClick={() => setConfirmDelete(true)}>
        <Trash2 aria-hidden />
      </IconButton>
    </>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 lg:mx-0">
      <Link
        href="/notes"
        className="-mt-1 -ml-1 inline-flex h-9 items-center gap-1 self-start rounded-control pr-2 text-base text-fg-muted hover:text-fg lg:hidden"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Notes
      </Link>
      <PageHeader title={title.trim() || "Sans titre"} actions={actions} className="lg:hidden" />
      <h1 className="sr-only max-lg:hidden">{title.trim() || "Sans titre"}</h1>
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sans titre"
            aria-label="Titre"
            maxLength={160}
            className="min-w-0 flex-1 rounded-control bg-transparent py-1 text-xl font-semibold text-fg outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <div className="hidden shrink-0 items-center gap-1 pt-1 lg:flex">{actions}</div>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-subtle" aria-live="polite">
          <span>{note.author.isMe ? "Écrite par toi" : `Écrite par ${note.author.name}`}</span>
          <span aria-hidden>·</span>
          <span data-testid="save-status">{statusText}</span>
          {status === "error" ? (
            <span className="inline-flex items-center gap-2 text-negative">
              {error}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => void save()}>
                Réessayer
              </button>
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Mode"
          value={mode}
          onValueChange={setMode}
          fill={false}
          size="sm"
          options={[
            { value: "edit", label: "Écrire" },
            { value: "preview", label: "Aperçu" },
          ]}
        />
        {mode === "edit" ? (
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Contenu (Markdown)"
            placeholder={"Écris ici. Markdown accepté : # titre, - liste, **gras**, [lien](https://…)"}
            className="min-h-64 max-h-none leading-relaxed"
            maxLength={50000}
          />
        ) : (
          <div className="min-h-32 rounded-card bg-surface px-4 py-4 md:px-5">
            {body.trim() ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-base text-fg-subtle">Rien à afficher. Passe en mode Écrire pour commencer.</p>
            )}
          </div>
        )}
      </div>

      <Field label="Étiquettes">
        <TagsEditor value={tags} onChange={setTags} max={12} />
      </Field>

      <div className="rounded-card bg-surface px-4">
        <Switch
          label={
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" aria-hidden />
              Privé
            </span>
          }
          description={
            canChangePrivacy
              ? isPrivate
                ? "Visible seulement par toi."
                : "Visible par vous deux. Active pour la garder pour toi."
              : `Seule la personne qui a écrit la note (${note.author.name}) peut changer sa confidentialité.`
          }
          checked={isPrivate}
          disabled={!canChangePrivacy}
          onCheckedChange={(next) => {
            setIsPrivate(next);
            void patchFlag({ isPrivate: next });
          }}
        />
      </div>

      <Attachments attachments={data.attachments} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette note ?"
        description="Elle disparaîtra pour vous deux. Cette action est définitive."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          try {
            deleted.current = true;
            await callOp("notes.delete", { id: note.id });
            await qc.invalidateQueries({ queryKey: ["op", "notes.list"] });
            router.push("/notes");
          } catch (e) {
            deleted.current = false;
            toast.error(e instanceof ApiError ? e.message : "Suppression impossible.");
          }
        }}
      />
    </div>
  );
}

function Attachments({ attachments }: { attachments: NoteData["attachments"] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (!attachments.length) return null;

  async function open(id: string, external: string | null) {
    if (external) {
      window.open(external, "_blank", "noopener,noreferrer");
      return;
    }
    // Signed URLs expire: fetch one on click. Open the tab first so popup blockers allow it.
    const w = window.open("about:blank", "_blank");
    setOpening(id);
    try {
      const r = await callOp("condo.documentUrl", { id });
      if (w) {
        w.opener = null;
        w.location.href = r.url;
      } else {
        window.location.assign(r.url);
      }
    } catch (e) {
      w?.close();
      toast.error(e instanceof ApiError ? e.message : "Impossible d'ouvrir la pièce jointe.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Pièces jointes">
      <SectionHeader title="Pièces jointes" />
      <ul className="cn-list overflow-hidden rounded-card bg-surface">
        {attachments.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => void open(a.id, a.external_url)}
              disabled={opening === a.id}
              className="pressable flex min-h-[52px] w-full items-center gap-3 pl-4 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              {a.external_url ? <ExternalLink className="size-4 shrink-0 text-fg-subtle" aria-hidden /> : <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
              <span className="cn-row-sep relative flex min-w-0 flex-1 items-center self-stretch pr-4">
                <span className={cn("truncate text-base text-fg")}>{a.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
