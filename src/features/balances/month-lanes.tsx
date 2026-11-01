"use client";

import { Avatar, Money } from "@/components/ui";
import { formatMonthFr } from "@/domain/dates";
import { cn } from "@/lib/ui/cn";
import { usePersonTone } from "@/lib/ui/people";
import type { OpOutput } from "@/lib/data/api";

export type Lanes = OpOutput<"dashboard.get">["lanes"];

type Lane = {
  key: string;
  tone: string | "joint";
  label: string;
  avatarName: string;
  paidCents: number;
  /** Where the person's fair share (by the household ratio) falls, in cents. */
  fairCents: number | null;
  ratioPct: number | null;
};

/**
 * Signature block: the couple as three lanes — Moi · Commun · partner — with what each
 * paid this month on shared expenses and, for each partner, a tick at their fair share by
 * the income ratio. One sentence says what it means.
 */
export function MonthLanes({ lanes, className, title = true }: { lanes: Lanes; className?: string; title?: boolean }) {
  const me = lanes.members.find((m) => m.isMe);
  const partner = lanes.members.find((m) => !m.isMe) ?? null;
  const memberPaid = lanes.members.reduce((s, m) => s + m.paidCents, 0);
  const scale = Math.max(1, lanes.totalSharedCents);

  const rows: Lane[] = [
    ...(me
      ? [{ key: me.userId, tone: me.userId, label: "Moi", avatarName: me.name, paidCents: me.paidCents, fairCents: partner ? Math.round((memberPaid * me.ratioBp) / 10000) : null, ratioPct: partner ? Math.round(me.ratioBp / 100) : null }]
      : []),
    { key: "joint", tone: "joint", label: lanes.joint.name || "Compte commun", avatarName: "Compte commun", paidCents: lanes.joint.paidCents, fairCents: null, ratioPct: null },
    ...(partner
      ? [{ key: partner.userId, tone: partner.userId, label: partner.name, avatarName: partner.name, paidCents: partner.paidCents, fairCents: Math.round((memberPaid * partner.ratioBp) / 10000), ratioPct: Math.round(partner.ratioBp / 100) }]
      : []),
  ];

  return (
    <section aria-labelledby="lanes-title" className={cn("flex flex-col gap-4 rounded-card bg-surface p-4 md:p-5", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 id="lanes-title" className={cn("text-base font-medium text-fg", !title && "sr-only")}>
          Qui a payé en {formatMonthFr(lanes.month).replace(/ \d{4}$/, "")}
        </h2>
        <p className="text-sm text-fg-subtle">
          <Money cents={lanes.totalSharedCents} className="text-fg-muted" /> de dépenses partagées
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => (
          <LaneRow key={r.key} lane={r} scale={scale} />
        ))}
      </ul>
      {lanes.finding ? <p className="text-base text-fg-muted text-pretty">{lanes.finding}</p> : null}
    </section>
  );
}

function LaneRow({ lane, scale }: { lane: Lane; scale: number }) {
  const tone = usePersonTone(lane.tone);
  const fill = Math.min(1, lane.paidCents / scale);
  const tick = lane.fairCents !== null ? Math.min(1, lane.fairCents / scale) : null;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Avatar name={lane.avatarName} size="sm" tone={tone.key} decorative />
        <span className="min-w-0 flex-1 truncate text-base text-fg">{lane.label}</span>
        <Money cents={lane.paidCents} className="text-base font-medium text-fg" />
      </div>
      <div className="relative h-2.5" aria-hidden>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-track">
          <div
            className={cn("h-full w-full rounded-full transition-transform duration-[320ms] ease-snappy", tone.solid)}
            style={{ transform: `translateX(${(fill - 1) * 100}%)` }}
          />
        </div>
        {tick !== null ? (
          <span className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" style={{ left: `${tick * 100}%` }} />
        ) : null}
      </div>
      {lane.fairCents !== null ? (
        <span className="text-sm text-fg-subtle">
          Juste part selon le ratio ({lane.ratioPct} %) : <Money cents={lane.fairCents} />
        </span>
      ) : (
        <span className="text-sm text-fg-subtle">Ne crée aucune dette entre vous</span>
      )}
    </li>
  );
}
