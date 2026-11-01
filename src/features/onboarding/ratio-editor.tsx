"use client";

import { Slider } from "radix-ui";
import { useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { cn } from "@/lib/ui/cn";
import { personTone, type PersonToneClasses } from "./person-tone";

export type RatioMember = { userId: string; displayName: string; isMe: boolean; incomeWeightBp: number };

const PRESETS = [50, 55, 60, 65, 70];

/** Whole-percent share of the first member, from stored basis points. */
export const initialPct = (members: RatioMember[]) => Math.round((members[0]?.incomeWeightBp ?? 5000) / 100);

/** `{ userId: bp }` for household.updateSettings. */
export const toWeights = (members: RatioMember[], pct: number): Record<string, number> => ({
  [members[0].userId]: pct * 100,
  [members[1].userId]: (100 - pct) * 100,
});

/**
 * Controlled income-ratio slider between the two members (1 % steps).
 * Each side is drawn in its person tone; quick presets underneath.
 */
export function RatioSlider({
  members,
  value,
  onValueChange,
  className,
}: {
  members: RatioMember[];
  value: number;
  onValueChange: (pct: number) => void;
  className?: string;
}) {
  const [a, b] = members;
  if (!a || !b) return null;
  const toneA = personTone(a.userId, members);
  const toneB = personTone(b.userId, members);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-4">
        <Side member={a} pct={value} tone={toneA} />
        <Side member={b} pct={100 - value} tone={toneB} align="end" />
      </div>
      <Slider.Root
        value={[value]}
        min={0}
        max={100}
        step={1}
        onValueChange={([v]) => onValueChange(v)}
        className="relative flex h-11 w-full touch-none items-center select-none"
      >
        <Slider.Track className={cn("relative h-2 grow overflow-hidden rounded-full", toneB.fill)}>
          <Slider.Range className={cn("absolute h-full", toneA.fill)} />
        </Slider.Track>
        <Slider.Thumb
          aria-label={`Part de ${a.displayName}`}
          aria-valuetext={`${a.displayName} ${value} %, ${b.displayName} ${100 - value} %`}
          className={cn(
            "relative block size-6 rounded-full border border-border-strong bg-surface shadow-float",
            "before:absolute before:-inset-2.5 before:content-['']",
          )}
        />
      </Slider.Root>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ratios courants">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onValueChange(p)}
            aria-pressed={value === p}
            className={cn(
              "pressable num h-9 rounded-control px-3 text-sm md:h-8",
              value === p ? "bg-fg text-bg" : "bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            {p} / {100 - p}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ratio slider with its own save button (Réglages). */
export function RatioEditor({ members, className }: { members: RatioMember[]; className?: string }) {
  const stored = initialPct(members);
  const [draft, setDraft] = useState<number | null>(null);
  const pct = draft ?? stored;
  const save = useOpMutation("household.updateSettings", {
    onSuccess: () => {
      setDraft(null);
      haptic("success");
    },
  });
  if (members.length < 2) return null;
  const dirty = pct !== stored;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <RatioSlider members={members} value={pct} onValueChange={setDraft} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-subtle">On garde le ratio, jamais vos salaires.</p>
        <div className="flex gap-2">
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Annuler
            </Button>
          ) : null}
          {dirty || save.isPending ? (
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ incomeWeightsBp: toWeights(members, pct) })}>
              Enregistrer le ratio
            </Button>
          ) : null}
        </div>
      </div>
      {save.error ? (
        <p className="text-sm text-negative" role="alert">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}

function Side({ member, pct, tone, align = "start" }: { member: RatioMember; pct: number; tone: PersonToneClasses; align?: "start" | "end" }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", align === "end" && "flex-row-reverse text-right")}>
      <Avatar name={member.displayName} size="md" decorative tone={tone.avatar} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-fg-muted">{member.isMe ? `${member.displayName} (toi)` : member.displayName}</span>
        <span className={cn("num text-lg font-semibold", tone.ink)}>{pct} %</span>
      </div>
    </div>
  );
}
