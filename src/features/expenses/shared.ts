"use client";

import { computeSplits, describeSplit } from "@/domain/splits";
import { addDays, formatDateFr, formatDateShortFr, todayIn } from "@/domain/dates";
import type { OpOutput } from "@/lib/data/api";
import type { HouseholdSession } from "@/features/app/session";

export type Expense = OpOutput<"expenses.list">["expenses"][number];
export type Member = HouseholdSession["household"]["members"][number];

/** Who paid, as the form sees it. */
export type PayerChoice = "me" | "partner" | "joint";
export type SplitModeChoice = "equal" | "income" | "percentage" | "exact";

/** "Aujourd'hui", "Hier", "1 nov." (year added when it is not the current one). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Aujourd'hui";
  if (date === addDays(today, -1)) return "Hier";
  return date.slice(0, 4) === today.slice(0, 4) ? formatDateShortFr(date) : formatDateFr(date);
}

/** Civil date (household zone) of an ISO timestamp. */
export function civilDateOf(iso: string, timeZone: string): string {
  return todayIn(timeZone, new Date(iso));
}

/** Ratio label from members' income weights, in member order: "55/45". */
export function incomeRatioLabel(members: Member[]): string | null {
  const total = members.reduce((s, m) => s + m.incomeWeightBp, 0);
  if (members.length < 2 || total <= 0) return null;
  return describeSplit(
    members.map((m) => ({ userId: m.userId, shareCents: m.incomeWeightBp })),
    members.map((m) => m.userId),
  ).label;
}

/** Short label of how an expense is split: "50/50", "55/45", "Commun", "Privé". */
export function splitLabel(e: Expense, members: Member[]): string {
  if (e.isPrivate) return "Privé";
  if (e.payer.kind === "joint") return "Commun";
  if (e.splitMode === "none" || e.splits.length === 0) return "—";
  return describeSplit(
    e.splits.map((s) => ({ userId: s.userId, shareCents: s.shareCents })),
    members.map((m) => m.userId),
  ).label;
}

export type ShareCandidate = {
  mode: SplitModeChoice;
  /** My percentage (0–100) in percentage mode. */
  myPercent: number;
  exactMineCents: number | null;
  exactPartnerCents: number | null;
};

/** Live preview of the shares (same allocation as the server). Null when not computable yet. */
export function previewShares(
  totalCents: number | null,
  split: ShareCandidate,
  me: Member,
  partner: Member | null,
  members: Member[],
): { userId: string; shareCents: number }[] | null {
  if (!partner || totalCents === null || totalCents <= 0) return null;
  try {
    const order = members.map((m) => m.userId);
    return computeSplits({
      totalCents,
      mode: split.mode,
      memberOrder: order,
      percentagesBp: { [me.userId]: split.myPercent * 100, [partner.userId]: (100 - split.myPercent) * 100 },
      exactCents: { [me.userId]: split.exactMineCents ?? 0, [partner.userId]: split.exactPartnerCents ?? 0 },
      incomeWeightsBp: Object.fromEntries(members.map((m) => [m.userId, m.incomeWeightBp])),
    }).map((s) => ({ userId: s.userId, shareCents: s.shareCents }));
  } catch {
    return null;
  }
}
