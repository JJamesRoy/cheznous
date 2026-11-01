"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Stable person hues (docs/DESIGN.md §1): the first member of the household (canonical order:
 * joined first) is river blue, the second ochre, the joint account the house iron green. These are
 * identity colours — pale tint with the dark ink of the same hue — never data series beyond the two
 * partners, and never used for good/bad.
 */
export type PersonKey = "a" | "b" | "joint" | "neutral";

export type PersonTone = {
  key: PersonKey;
  /** Tailwind classes: pale tint background + dark ink text. */
  chip: string;
  /** Tailwind class for a solid mark (bar fill, dot). */
  solid: string;
  /** Tailwind class for ink-coloured text. */
  text: string;
  /** CSS variables, for inline SVG. */
  vars: { solid: string; tint: string; ink: string };
};

const TONES: Record<PersonKey, PersonTone> = {
  a: {
    key: "a",
    chip: "bg-person-a-tint text-person-a-ink",
    solid: "bg-person-a",
    text: "text-person-a-ink",
    vars: { solid: "var(--person-a)", tint: "var(--person-a-tint)", ink: "var(--person-a-ink)" },
  },
  b: {
    key: "b",
    chip: "bg-person-b-tint text-person-b-ink",
    solid: "bg-person-b",
    text: "text-person-b-ink",
    vars: { solid: "var(--person-b)", tint: "var(--person-b-tint)", ink: "var(--person-b-ink)" },
  },
  joint: {
    key: "joint",
    chip: "bg-person-joint-tint text-person-joint-ink",
    solid: "bg-person-joint",
    text: "text-person-joint-ink",
    vars: { solid: "var(--person-joint)", tint: "var(--person-joint-tint)", ink: "var(--person-joint-ink)" },
  },
  neutral: {
    key: "neutral",
    chip: "bg-surface-2 text-fg-muted",
    solid: "bg-gray-8",
    text: "text-fg-muted",
    vars: { solid: "var(--gray-8)", tint: "var(--surface-2)", ink: "var(--fg-muted)" },
  },
};

export const personTone = (key: PersonKey): PersonTone => TONES[key];

const PeopleContext = createContext<string[]>([]);

/** Provide the household's member ids in canonical order (joined first). */
export function PeopleProvider({ memberIds, children }: { memberIds: string[]; children: ReactNode }) {
  return <PeopleContext.Provider value={memberIds}>{children}</PeopleContext.Provider>;
}

/** Tone for a member id, or "joint" for the joint account. Unknown → neutral. */
export function usePersonTone(who: string | "joint" | null | undefined): PersonTone {
  const ids = useContext(PeopleContext);
  if (who === "joint") return TONES.joint;
  const i = who ? ids.indexOf(who) : -1;
  return i === 0 ? TONES.a : i === 1 ? TONES.b : TONES.neutral;
}

/** Non-hook variant when you already have the ordered ids. */
export function toneForMember(memberIds: string[], who: string | "joint" | null | undefined): PersonTone {
  if (who === "joint") return TONES.joint;
  const i = who ? memberIds.indexOf(who) : -1;
  return i === 0 ? TONES.a : i === 1 ? TONES.b : TONES.neutral;
}
