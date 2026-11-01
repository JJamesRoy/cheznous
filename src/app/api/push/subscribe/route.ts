import { z } from "zod";
import { authed, json } from "../shared";

const Body = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Store this browser's Web Push subscription for the signed-in user. */
export async function POST(request: Request) {
  const a = await authed(request);
  if (a instanceof Response) return a;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "Abonnement invalide." });
  const { endpoint, keys } = parsed.data;
  const row = {
    user_id: a.userId,
    endpoint,
    p256dh: keys.p256dh,
    auth_key: keys.auth,
    user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
  const { error } = await a.db.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error) {
    // The same browser endpoint may still belong to another account (RLS hides it).
    if (error.code === "42501" || error.code === "23505") {
      return json(409, { error: "Ce navigateur reçoit déjà les notifications d'un autre compte. Désactive-les sur ce compte d'abord." });
    }
    console.error("[push] subscribe", error.code, error.message);
    return json(500, { error: "Impossible d'activer les notifications." });
  }
  return json(200, { ok: true });
}
