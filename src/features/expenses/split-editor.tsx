"use client";

import { Check } from "lucide-react";
import { Field, Money, MoneyInput, SegmentedControl } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { centsToInput, parseMoneyInput } from "@/lib/ui/format";
import { incomeRatioLabel, previewShares, type Member, type SplitModeChoice } from "./shared";

export type SplitState = {
  mode: SplitModeChoice;
  myPercent: number;
  exactMine: string;
  exactPartner: string;
  /** Which exact field the person typed in last (the other one auto-completes until touched). */
  exactTouched: { mine: boolean; partner: boolean };
};

export function initialSplit(mode: SplitModeChoice, me: Member, members: Member[]): SplitState {
  const total = members.reduce((s, m) => s + m.incomeWeightBp, 0);
  const myPercent = total > 0 ? Math.round((me.incomeWeightBp * 100) / total) : 50;
  return { mode, myPercent, exactMine: "", exactPartner: "", exactTouched: { mine: false, partner: false } };
}

const parse = parseMoneyInput;

export function splitCandidate(s: SplitState) {
  return { mode: s.mode, myPercent: s.myPercent, exactMineCents: parse(s.exactMine), exactPartnerCents: parse(s.exactPartner) };
}

/** Exact-split check: remaining cents to allocate (negative when over). Null when not in exact mode. */
export function exactRemaining(s: SplitState, totalCents: number | null): number | null {
  if (s.mode !== "exact" || totalCents === null) return null;
  return totalCents - (parse(s.exactMine) ?? 0) - (parse(s.exactPartner) ?? 0);
}

/** Input for the server (`zSplitInput`). */
export function splitInput(s: SplitState, me: Member, partner: Member) {
  switch (s.mode) {
    case "equal":
      return { mode: "equal" as const };
    case "income":
      return { mode: "income" as const };
    case "percentage":
      return { mode: "percentage" as const, percentages: { [me.userId]: s.myPercent, [partner.userId]: 100 - s.myPercent } };
    case "exact":
      return {
        mode: "exact" as const,
        exact: { [me.userId]: { cents: parse(s.exactMine) ?? 0 }, [partner.userId]: { cents: parse(s.exactPartner) ?? 0 } },
      };
  }
}

const MODE_HINT: Record<SplitModeChoice, string> = {
  equal: "Moitié-moitié",
  income: "Selon vos revenus",
  percentage: "Pourcentage",
  exact: "Montants exacts",
};

export function SplitEditor({
  value,
  onChange,
  totalCents,
  me,
  partner,
  members,
}: {
  value: SplitState;
  onChange: (next: SplitState) => void;
  totalCents: number | null;
  me: Member;
  partner: Member;
  members: Member[];
}) {
  const ratio = incomeRatioLabel(members);
  const shares = previewShares(totalCents, splitCandidate(value), me, partner, members);
  const remaining = exactRemaining(value, totalCents);
  const shareOf = (id: string) => shares?.find((s) => s.userId === id)?.shareCents ?? null;

  const setMode = (mode: SplitModeChoice) => {
    if (mode === "exact" && !value.exactMine && !value.exactPartner && totalCents) {
      // Start from the equal split so the person only adjusts.
      const half = Math.floor(totalCents / 2);
      onChange({ ...value, mode, exactMine: centsToInput(totalCents - half), exactPartner: centsToInput(half), exactTouched: { mine: false, partner: false } });
      return;
    }
    onChange({ ...value, mode });
  };

  const setExact = (side: "mine" | "partner", text: string, cents: number | null) => {
    const other = side === "mine" ? "partner" : "mine";
    const next: SplitState = { ...value, exactTouched: { ...value.exactTouched, [side]: true } };
    if (side === "mine") next.exactMine = text;
    else next.exactPartner = text;
    // Auto-complete the other side until it has been typed in.
    if (!value.exactTouched[other] && totalCents !== null && cents !== null && cents <= totalCents) {
      if (other === "mine") next.exactMine = centsToInput(totalCents - cents);
      else next.exactPartner = centsToInput(totalCents - cents);
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg" id="split-label">
          Partage
        </span>
        <SegmentedControl
          aria-label="Mode de partage"
          size="sm"
          value={value.mode}
          onValueChange={setMode}
          options={[
            { value: "equal", label: "50/50" },
            { value: "income", label: ratio ?? "Ratio", disabled: !ratio },
            { value: "percentage", label: "%" },
            { value: "exact", label: "Exact" },
          ]}
        />
      </div>

      {value.mode === "percentage" ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-fg">
              Toi <span className="num font-medium">{value.myPercent} %</span>
            </span>
            <span className="text-fg">
              {partner.displayName} <span className="num font-medium">{100 - value.myPercent} %</span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value.myPercent}
            aria-label={`Ta part en pourcentage (${partner.displayName} : ${100 - value.myPercent} %)`}
            aria-valuetext={`Toi ${value.myPercent} %, ${partner.displayName} ${100 - value.myPercent} %`}
            onChange={(e) => onChange({ ...value, myPercent: Number(e.target.value) })}
            className="h-11 w-full cursor-pointer accent-(--accent) md:h-8"
          />
        </div>
      ) : null}

      {value.mode === "exact" ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ta part">
              <MoneyInput value={value.exactMine} onValueChange={(t, c) => setExact("mine", t, c)} />
            </Field>
            <Field label={`Part de ${partner.displayName}`}>
              <MoneyInput value={value.exactPartner} onValueChange={(t, c) => setExact("partner", t, c)} />
            </Field>
          </div>
          {remaining !== null ? (
            <p
              aria-live="polite"
              className={cn("flex items-center gap-1.5 text-sm", remaining === 0 ? "text-fg-subtle" : remaining > 0 ? "text-warning" : "text-negative")}
            >
              {remaining === 0 ? (
                <>
                  <Check aria-hidden className="size-4" /> Le total est réparti.
                </>
              ) : remaining > 0 ? (
                <>
                  Reste <Money cents={remaining} /> à répartir
                </>
              ) : (
                <>
                  Dépasse le total de <Money cents={-remaining} />
                </>
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {value.mode !== "exact" ? (
        <p className="flex flex-wrap gap-x-3 text-sm text-fg-subtle" aria-live="polite">
          <span className="text-fg-muted">{MODE_HINT[value.mode]}</span>
          <span aria-hidden>·</span>
          <span>
            Toi {shareOf(me.userId) !== null ? <Money cents={shareOf(me.userId)!} className="text-fg-muted" /> : "—"}
          </span>
          <span aria-hidden>·</span>
          <span>
            {partner.displayName} {shareOf(partner.userId) !== null ? <Money cents={shareOf(partner.userId)!} className="text-fg-muted" /> : "—"}
          </span>
        </p>
      ) : null}
    </div>
  );
}
