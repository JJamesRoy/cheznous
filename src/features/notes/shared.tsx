"use client";

import { Fragment } from "react";
import { diffDays, formatDateFr, todayIn } from "@/domain/dates";

/** "aujourd'hui", "hier", "il y a 3 jours", then "12 oct. 2026". */
export function updatedLabel(timestamp: string, timeZone: string, today: string): string {
  const day = todayIn(timeZone, new Date(timestamp));
  const n = diffDays(day, today);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "hier";
  if (n < 7) return `il y a ${n} jours`;
  return formatDateFr(day);
}

/** Search snippet: « … » markers from ts_headline become <mark>. */
export function Snippet({ text }: { text: string }) {
  // Strip Markdown syntax from the raw-body headline, keep the « » match markers.
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>#]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = plain.split(/«([^»]*)»/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-control bg-accent-soft px-0.5 text-fg">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
