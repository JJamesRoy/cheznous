"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { IconButton, Input } from "@/components/ui";
import { ApiError } from "@/lib/data/api";
import { cn } from "@/lib/ui/cn";
import { addItemLine } from "./pending-store";

export type AddItemInputHandle = { focus: () => void };

/**
 * One-line entry: "2 lait 3,99" (quantity and price are parsed server-side). Enter adds and keeps
 * the focus in the field for rapid entry; works offline (queued with an idempotency key).
 */
export const AddItemInput = forwardRef<
  AddItemInputHandle,
  {
    listId: string | null;
    listName?: string;
    autoFocus?: boolean;
    onAdded?: (line: string, queued: boolean) => void;
    className?: string;
  }
>(function AddItemInput({ listId, listName, autoFocus, onAdded, className }, ref) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  function submit() {
    const line = value.trim();
    if (!line || !listId) return;
    setValue("");
    setError(null);
    inputRef.current?.focus();
    addItemLine(qc, listId, line)
      .then((r) => onAdded?.(line, r.queued))
      .catch((e: unknown) => {
        setValue((cur) => cur || line);
        setError(e instanceof ApiError ? e.message : "Impossible d'ajouter l'article. Réessaie.");
      });
  }

  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        autoFocus={autoFocus}
        disabled={!listId}
        placeholder="Ajouter… ex. 2 lait 3,99"
        aria-label={listName ? `Ajouter un article à ${listName}` : "Ajouter un article"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "add-item-error" : undefined}
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="enter"
        maxLength={200}
        trailing={
          <IconButton
            type="submit"
            label="Ajouter"
            size="icon-sm"
            disabled={!value.trim() || !listId}
            // Keep the keyboard open on mobile.
            onPointerDown={(event) => event.preventDefault()}
            className="text-fg-subtle"
          >
            <CornerDownLeft aria-hidden />
          </IconButton>
        }
      />
      {error ? (
        <p id="add-item-error" role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </form>
  );
});
