"use client";

import { AnimatePresence, m } from "motion/react";
import { Camera, FileText, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton, Spinner } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/ui/cn";

const BUCKET = "household-files";
const ease = [0.23, 1, 0.32, 1] as const;

type Status =
  | { kind: "idle" }
  | { kind: "working"; step: "compress" | "upload"; previewUrl: string | null; isPdf: boolean }
  | { kind: "done"; previewUrl: string | null; isPdf: boolean }
  | { kind: "error"; message: string };

/** Signed URL for a stored receipt (5 minutes). */
export function useReceiptUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void getBrowserSupabase()
      .storage.from(BUCKET)
      .createSignedUrl(path, 300)
      .then(({ data }) => {
        if (alive) setUrl({ path, url: data?.signedUrl ?? null });
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return path && url?.path === path ? url.url : null;
}

async function compress(file: File): Promise<File> {
  const { default: imageCompression } = await import("browser-image-compression");
  return imageCompression(file, {
    maxWidthOrHeight: 1600,
    maxSizeMB: 0.4,
    fileType: "image/jpeg",
    initialQuality: 0.8,
    useWebWorker: true,
  });
}

/**
 * Receipt picker: dropzone (camera on mobile) → client-side compression → upload to
 * `${householdId}/receipts/…` → thumbnail that grows out of the dropzone.
 */
export function ReceiptField({
  householdId,
  value,
  onChange,
  onBusyChange,
}: {
  householdId: string;
  /** Stored path, or null. */
  value: string | null;
  onChange: (path: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const storedUrl = useReceiptUrl(status.kind === "idle" ? value : null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  useEffect(() => {
    onBusyChange?.(status.kind === "working");
  }, [status.kind, onBusyChange]);

  async function handle(file: File) {
    setLastFile(file);
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setStatus({ kind: "error", message: "Choisis une photo ou un PDF." });
      return;
    }
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    setStatus({ kind: "working", step: isImage ? "compress" : "upload", previewUrl, isPdf });
    try {
      let body: File = file;
      if (isImage) {
        try {
          body = await compress(file);
        } catch {
          // Format the browser cannot decode (e.g. HEIC outside Safari): keep the original.
          body = file;
        }
      }
      if (body.size > 25 * 1024 * 1024) throw new Error("Ce fichier dépasse 25 Mo.");
      setStatus({ kind: "working", step: "upload", previewUrl, isPdf });
      const ext = isPdf ? "pdf" : body.type === "image/jpeg" ? "jpg" : (body.type.split("/")[1] ?? "jpg");
      const path = `${householdId}/receipts/${crypto.randomUUID()}.${ext}`;
      const { error } = await getBrowserSupabase().storage.from(BUCKET).upload(path, body, { contentType: body.type, upsert: false });
      if (error) throw new Error(navigator.onLine ? "Le reçu n'a pas pu être envoyé." : "Hors ligne : le reçu ne peut pas être envoyé.");
      setStatus({ kind: "done", previewUrl, isPdf });
      onChange(path);
    } catch (e) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setStatus({ kind: "error", message: (e as Error).message || "Le reçu n'a pas pu être envoyé." });
    }
  }

  function clear() {
    if ((status.kind === "done" || status.kind === "working") && status.previewUrl) URL.revokeObjectURL(status.previewUrl);
    setStatus({ kind: "idle" });
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasFile = status.kind === "working" || status.kind === "done" || (status.kind === "idle" && value);
  const preview = status.kind === "working" || status.kind === "done" ? status.previewUrl : storedUrl;
  const isPdf = status.kind === "working" || status.kind === "done" ? status.isPdf : (value?.endsWith(".pdf") ?? false);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">Reçu</span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      <m.div
        layout
        transition={{ duration: 0.32, ease }}
        className={cn(
          "relative overflow-hidden rounded-control bg-surface-2",
          !hasFile && "outline-1 -outline-offset-1 outline-border-strong outline-dashed",
          dragOver && "outline-accent",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handle(f);
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {hasFile ? (
            <m.div
              key="preview"
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease }}
              className="flex items-center gap-3 p-2"
            >
              <a
                href={preview ?? undefined}
                target="_blank"
                rel="noreferrer"
                aria-label="Ouvrir le reçu"
                className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface"
              >
                {preview && !isPdf ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob/signed URLs, not optimizable
                  <img src={preview} alt="" className="size-full object-cover" />
                ) : isPdf ? (
                  <FileText aria-hidden className="size-6 text-fg-subtle" />
                ) : (
                  <Spinner />
                )}
              </a>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base text-fg">{isPdf ? "Reçu (PDF)" : "Photo du reçu"}</span>
                <span className="flex items-center gap-1.5 text-sm text-fg-subtle" aria-live="polite">
                  {status.kind === "working" ? (
                    <>
                      <Spinner /> {status.step === "compress" ? "Compression…" : "Envoi…"}
                    </>
                  ) : (
                    "Joint à la dépense"
                  )}
                </span>
              </div>
              <IconButton label="Retirer le reçu" size="icon-sm" onClick={clear} disabled={status.kind === "working"}>
                <X aria-hidden />
              </IconButton>
            </m.div>
          ) : (
            <m.label
              key="drop"
              htmlFor={inputId}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className="pressable flex min-h-14 cursor-pointer items-center justify-center gap-2 px-4 py-3 text-base text-fg-muted hover:text-fg focus-visible:-outline-offset-2"
            >
              <Camera aria-hidden className="size-4" />
              <span>Photographier ou choisir un reçu</span>
            </m.label>
          )}
        </AnimatePresence>
      </m.div>
      {status.kind === "error" ? (
        <p className="flex items-center gap-2 text-sm text-negative" role="alert">
          {status.message}
          {lastFile ? (
            <button type="button" className="inline-flex items-center gap-1 text-fg underline-offset-4 hover:underline" onClick={() => void handle(lastFile)}>
              <RotateCcw aria-hidden className="size-3.5" /> Réessayer
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
