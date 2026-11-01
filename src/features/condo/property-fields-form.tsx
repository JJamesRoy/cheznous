"use client";

import { useState } from "react";
import { Button, DateInput, Field, Input, MoneyInput, SheetFooter } from "@/components/ui";
import type { OpInput } from "@/lib/data/api";
import { useOpMutation } from "@/lib/data/query";
import { centsToInput } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";

type PropertyInput = OpInput<"condo.upsertProperty">;

export type PropertyFieldDef = {
  key: keyof PropertyInput;
  label: string;
  type: "text" | "email" | "tel" | "date" | "money";
  hint?: string;
  placeholder?: string;
  /** Current value: text/ISO date, or cents for money. */
  value: string | number | null | undefined;
  /** Lay out two fields side by side (pairs). */
  half?: boolean;
};

/** Small edit form over a subset of the property's fields (null clears a field). */
export function PropertyFieldsForm({
  fields,
  onDone,
  submitLabel = "Enregistrer",
}: {
  fields: PropertyFieldDef[];
  onDone: () => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, f.type === "money" ? centsToInput(f.value as number | null) : ((f.value as string | null) ?? "")]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useOpMutation("condo.upsertProperty");
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key].trim();
      input[f.key] = v ? v : null;
    }
    try {
      await save.mutateAsync(input as PropertyInput);
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Group consecutive `half` fields in pairs.
  const rows: PropertyFieldDef[][] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (f.half && last && last.length === 1 && last[0].half) last.push(f);
    else rows.push([f]);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.map((f) => f.key).join("-")} className={row.length === 2 ? "grid grid-cols-2 gap-3" : "flex flex-col"}>
          {row.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {f.type === "money" ? (
                <MoneyInput value={values[f.key]} onValueChange={(t) => set(f.key, t)} />
              ) : f.type === "date" ? (
                <DateInput value={values[f.key]} onValueChange={(v) => set(f.key, v)} />
              ) : (
                <Input
                  type={f.type}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  inputMode={f.type === "tel" ? "tel" : f.type === "email" ? "email" : undefined}
                  autoComplete="off"
                />
              )}
            </Field>
          ))}
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {submitLabel}
        </Button>
      </SheetFooter>
    </form>
  );
}
