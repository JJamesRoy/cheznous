import { toneForMember, type PersonKey } from "@/lib/ui/people";

/** Classes for a member's stable tone (household canonical order: first = a, second = b). */
export type PersonToneClasses = { fill: string; ink: string; avatar: PersonKey };

export function personTone(userId: string, members: { userId: string }[]): PersonToneClasses {
  const t = toneForMember(
    members.map((m) => m.userId),
    userId,
  );
  return { fill: t.solid, ink: t.text, avatar: t.key };
}
