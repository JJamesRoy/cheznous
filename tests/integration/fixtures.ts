import { createUser, run, type TestUser } from "./helpers";
import * as household from "@/server/usecases/household";

export type Couple = { a: TestUser; b: TestUser; householdId: string };

/** A creates a household, invites B, B joins. Exactly the onboarding path of the app. */
export async function createCouple(names: [string, string] = ["Camille", "Alex"]): Promise<Couple> {
  const a = await createUser(names[0]);
  const b = await createUser(names[1]);
  const { householdId } = await run(a, household.createHousehold, { name: "Chez nous", displayName: names[0] });
  const inv = await run(a, household.createInvitation, {});
  await run(b, household.acceptInvitation, { token: inv.token, displayName: names[1] });
  return { a, b, householdId };
}
