"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Sheet, SheetFooter, Switch, Textarea } from "@/components/ui";
import type { QuickAddSheetProps } from "@/features/app/quick-add-sheets";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOpMutation } from "@/lib/data/query";

/** Quick note: title + body (Markdown), private toggle. Opens the note once created. */
export function QuickAddNote({ open, onOpenChange, prefill }: QuickAddSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nouvelle note">
      {open ? <QuickAddNoteForm prefill={prefill} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function QuickAddNoteForm({ prefill, onDone }: { prefill?: Record<string, unknown>; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(typeof prefill?.title === "string" ? prefill.title : "");
  const [body, setBody] = useState(typeof prefill?.body === "string" ? prefill.body : "");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const empty = !title.trim() && !body.trim();

  const create = useOpMutation("notes.create", {
    onSuccess: (r) => {
      onDone();
      router.push(`/notes/${r.note.id}`);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty) return;
        setError(null);
        create.mutate({ title: title.trim(), bodyMd: body, isPrivate, idempotencyKey: key });
      }}
    >
      <Field label="Titre">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus autoComplete="off" placeholder="Ex. : Code de la porte du garage" />
      </Field>
      <Field label="Note" hint="Markdown accepté : - liste, **gras**, [lien](https://…)">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={50000} />
      </Field>
      <Switch
        label="Privé"
        description={isPrivate ? "Visible seulement par toi." : "Visible par vous deux."}
        checked={isPrivate}
        onCheckedChange={setIsPrivate}
      />
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={create.isPending} disabled={empty}>
          Créer la note
        </Button>
      </SheetFooter>
    </form>
  );
}
