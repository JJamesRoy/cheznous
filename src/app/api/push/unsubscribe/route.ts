import { z } from "zod";
import { authed, json } from "../shared";

const Body = z.object({ endpoint: z.string().url().max(1000) });

/** Forget this browser's subscription (own rows only, via RLS). */
export async function POST(request: Request) {
  const a = await authed(request);
  if (a instanceof Response) return a;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "Requête invalide." });
  const { error } = await a.db.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint).eq("user_id", a.userId);
  if (error) {
    console.error("[push] unsubscribe", error.code, error.message);
    return json(500, { error: "Impossible de désactiver les notifications." });
  }
  return json(200, { ok: true });
}
