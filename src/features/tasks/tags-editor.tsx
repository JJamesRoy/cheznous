"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { controlClasses } from "@/components/ui/input";
import { useFieldControl } from "@/components/ui";

/** Tags as removable pills + a text field (Enter or comma adds). Lowercased, unique. */
export function TagsEditor({
  value,
  onChange,
  max = 10,
  placeholder = "Ajouter une étiquette",
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const control = useFieldControl({});

  function commit(text: string) {
    const parts = text.split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const next = [...new Set([...value, ...parts])].slice(0, max);
    onChange(next);
    setDraft("");
  }

  return (
    <div className={cn(controlClasses, "flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:outline-2 focus-within:outline-accent md:min-h-9", className)}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-2.5 text-sm text-fg">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            aria-label={`Retirer l'étiquette ${tag}`}
            className="flex size-6 items-center justify-center rounded-full text-fg-subtle hover:bg-surface hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      {value.length < max ? (
        <input
          {...control}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,]$/.test(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          maxLength={40}
          placeholder={value.length ? "" : placeholder}
          enterKeyHint="enter"
          autoComplete="off"
          className="h-8 min-w-24 flex-1 bg-transparent px-1 text-input text-fg outline-none placeholder:text-placeholder"
        />
      ) : null}
    </div>
  );
}
