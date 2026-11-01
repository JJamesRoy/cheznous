import webpush from "web-push";
import { authed, json, vapid } from "../shared";

/** Send a test notification to the caller's own subscriptions (all their devices). */
export async function POST(request: Request) {
  const a = await authed(request);
  if (a instanceof Response) return a;
  const keys = vapid();
  if (!keys) return json(503, { error: "Notifications non configurées sur ce serveur." });

  const { data, error } = await a.db.from("push_subscriptions").select("id, endpoint, p256dh, auth_key").eq("user_id", a.userId);
  if (error) {
    console.error("[push] list", error.code, error.message);
    return json(500, { error: "Impossible de lire tes abonnements." });
  }
  const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth_key: string }[];
  if (subs.length === 0) return json(404, { error: "Aucun appareil abonné. Active d'abord les notifications." });

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const payload = JSON.stringify({
    title: "Chez Nous",
    body: "Les notifications fonctionnent sur cet appareil.",
    tag: "test",
    url: "/reglages#notifications",
  });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload, { TTL: 60 });
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        else console.error("[push] send", status, (e as Error).message);
      }
    }),
  );
  if (gone.length) await a.db.from("push_subscriptions").delete().in("id", gone);
  if (sent === 0) return json(502, { error: "L'envoi a échoué. Réactive les notifications sur cet appareil." });
  return json(200, { ok: true, sent, removed: gone.length });
}
