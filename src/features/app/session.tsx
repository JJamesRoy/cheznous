"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OpOutput } from "@/lib/data/api";

export type Session = OpOutput<"session.get">;
export type HouseholdSession = Session & { household: NonNullable<Session["household"]> } & {
  categories: NonNullable<Session["categories"]>;
  lists: NonNullable<Session["lists"]>;
  projects: NonNullable<Session["projects"]>;
};

const SessionContext = createContext<HouseholdSession | null>(null);

export function SessionProvider({ value, children }: { value: HouseholdSession; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The signed-in user, their household, members, categories and lists. Only inside the app frame. */
export function useSession(): HouseholdSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside the app frame");
  return s;
}

export function useMembers() {
  const s = useSession();
  const me = s.household.members.find((m) => m.isMe)!;
  const partner = s.household.members.find((m) => !m.isMe) ?? null;
  return { me, partner, members: s.household.members, joint: s.household.jointAccount };
}
