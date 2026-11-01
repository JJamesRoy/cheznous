"use client";

import { ExternalLink, FileText, Link2, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  DateInput,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListGroup,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  toast,
} from "@/components/ui";
import { useSession } from "@/features/app/session";
import { callOp, type OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { haptic } from "@/lib/ui/haptics";
import { Badge, fmtDate, QueryError, Section } from "./ui";

type Doc = OpOutput<"condo.listDocuments">["documents"][number];
type DocType = Doc["docType"];

const MAX_BYTES = 50 * 1024 * 1024;
const sizeFmt = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 });
function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024 * 1024) return `${sizeFmt.format(Math.max(1, Math.round(bytes / 1024)))} Ko`;
  return `${sizeFmt.format(bytes / (1024 * 1024))} Mo`;
}
function fileKind(mime: string | null): string | null {
  if (!mime) return null;
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("word")) return "Word";
  if (mime.includes("sheet") || mime.includes("excel")) return "Tableur";
  return null;
}
const safeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-100) || "fichier";

/** Opens a document: a blank tab first (keeps the user gesture), then the signed URL. */
async function openDocument(doc: Doc) {
  const w = window.open("about:blank", "_blank");
  try {
    const r = await callOp("condo.documentUrl", { id: doc.id });
    if (w) {
      w.opener = null;
      w.location.href = r.url;
    } else {
      window.location.assign(r.url);
    }
  } catch (e) {
    w?.close();
    toast.error((e as Error).message);
  }
}

export function DocumentsSection() {
  const q = useOp("condo.listDocuments", {});
  const [adding, setAdding] = useState<null | "file" | "link">(null);
  const [toDelete, setToDelete] = useState<Doc | null>(null);
  const del = useOpMutation("condo.deleteDocument");

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setAdding("file")}>
        <Upload aria-hidden />
        Téléverser un fichier
      </Button>
      <Button size="sm" onClick={() => setAdding("link")}>
        <Link2 aria-hidden />
        Lien Google Drive
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-fg-muted">Déclaration de copropriété, procès-verbaux, attestation, factures : tout au même endroit.</p>
        {q.data && q.data.documents.length > 0 ? actions : null}
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-6" aria-busy>
          <Skeleton shape="card" className="h-[160px]" />
          <Skeleton shape="card" className="h-[110px]" />
        </div>
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="les documents" />
      ) : q.data.documents.length === 0 ? (
        <EmptyState
          message="Aucun document pour l'instant. Téléverse un PDF ou colle un lien Google Drive."
          action={actions}
        />
      ) : (
        q.data.docTypes
          .filter((t) => q.data.documents.some((d) => d.docType === t.value))
          .map((t) => (
            <Section key={t.value} title={t.label} id={`doc-${t.value}`}>
              <ListGroup as="ul">
                {q.data.documents
                  .filter((d) => d.docType === t.value)
                  .map((d) => (
                    <li key={d.id} className="flex items-center border-b border-border last:border-b-0">
                      <button
                        type="button"
                        onClick={() => void openDocument(d)}
                        className="pressable flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left hover:bg-surface-2 focus-visible:-outline-offset-2"
                        aria-label={`Ouvrir ${d.title}`}
                      >
                        {d.kind === "file" ? (
                          <FileText aria-hidden className="size-5 shrink-0 text-fg-subtle" />
                        ) : (
                          <Link2 aria-hidden className="size-5 shrink-0 text-fg-subtle" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-base text-fg">{d.title}</span>
                          <span className="flex items-center gap-2 truncate text-sm text-fg-subtle">
                            {d.provider === "google_drive" ? <Badge>Google Drive</Badge> : d.kind === "link" ? <Badge>Lien</Badge> : null}
                            <span className="truncate">
                              {[
                                fileKind(d.mimeType),
                                fileSize(d.sizeBytes),
                                d.documentDate ? fmtDate(d.documentDate) : `ajouté le ${fmtDate(d.createdAt.slice(0, 10))}`,
                                d.createdBy.name,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </span>
                        <ExternalLink aria-hidden className="size-4 shrink-0 text-gray-8" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Options pour ${d.title}`} className="mx-1 text-fg-subtle">
                            <MoreHorizontal aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem icon={<ExternalLink />} onSelect={() => void openDocument(d)}>
                            Ouvrir
                          </DropdownMenuItem>
                          <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setToDelete(d)}>
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
              </ListGroup>
            </Section>
          ))
      )}

      <Sheet
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        title={adding === "link" ? "Lien Google Drive" : "Téléverser un fichier"}
        description={adding === "link" ? "Le document reste dans ton Drive ; on garde seulement le lien." : "PDF, image ou document, 50 Mo maximum."}
      >
        {adding ? (
          <AddDocumentForm
            mode={adding}
            docTypes={q.data?.docTypes ?? []}
            onDone={() => setAdding(null)}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Supprimer « ${toDelete?.title ?? ""} » ?`}
        description={
          toDelete?.kind === "file"
            ? "Le fichier sera supprimé pour vous deux. Cette action est définitive."
            : "Le lien sera retiré de Chez Nous. Le document reste dans ton Google Drive."
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
            haptic("light");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function AddDocumentForm({
  mode,
  docTypes,
  onDone,
}: {
  mode: "file" | "link";
  docTypes: { value: DocType; label: string }[];
  onDone: () => void;
}) {
  const { household } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<DocType>("other");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useOpMutation("condo.addDocument");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "file" && !file) return setError("Choisis un fichier.");
    if (mode === "link" && !/^https?:\/\//i.test(url.trim())) return setError("Colle un lien qui commence par https://.");
    if (!title.trim()) return setError("Ajoute un titre.");
    setBusy(true);
    let storagePath: string | undefined;
    let uploaded = false;
    try {
      if (mode === "file" && file) {
        if (file.size > MAX_BYTES) throw new Error("Ce fichier dépasse 50 Mo.");
        storagePath = `${household.id}/documents/${crypto.randomUUID()}-${safeName(file.name)}`;
        const up = await getBrowserSupabase()
          .storage.from("household-files")
          .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (up.error) throw new Error(`Le téléversement a échoué : ${up.error.message}`);
        uploaded = true;
      }
      await add.mutateAsync({
        title: title.trim(),
        docType,
        ...(mode === "file"
          ? { storagePath, mimeType: file!.type || undefined, sizeBytes: file!.size }
          : { externalUrl: url.trim() }),
        documentDate: date || undefined,
      });
      haptic("success");
      onDone();
    } catch (err) {
      // Don't leave an orphan file behind when the record could not be saved.
      if (uploaded && storagePath) void getBrowserSupabase().storage.from("household-files").remove([storagePath]);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode === "file" ? (
        <Field label="Fichier">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
            <Button type="button" onClick={() => inputRef.current?.click()}>
              <Upload aria-hidden />
              {file ? "Changer" : "Choisir un fichier"}
            </Button>
            <span className="min-w-0 truncate text-sm text-fg-muted">
              {file ? `${file.name} · ${fileSize(file.size)}` : "Aucun fichier choisi"}
            </span>
          </div>
        </Field>
      ) : (
        <Field label="Lien" hint="Dans Drive : Partager › Copier le lien.">
          <Input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/…"
            autoComplete="off"
            autoFocus
          />
        </Field>
      )}
      <Field label="Titre">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Déclaration de copropriété 2019" maxLength={160} />
      </Field>
      <Field label="Type de document">
        <Select value={docType} onValueChange={(v) => setDocType(v as DocType)} options={docTypes.map((t) => ({ value: t.value, label: t.label }))} />
      </Field>
      <Field label="Date du document" hint="Facultatif">
        <DateInput value={date} onValueChange={setDate} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={busy}>
          {mode === "file" ? "Téléverser" : "Ajouter le lien"}
        </Button>
      </SheetFooter>
    </form>
  );
}
