"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton, Switch, toast } from "@/components/ui";
import { haptic } from "@/lib/ui/haptics";
import { InlineError, Panel, SettingsSection } from "./section";

type PushState = "checking" | "unsupported" | "ios-browser" | "unconfigured" | "denied" | "off" | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function getRegistration(register: boolean): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing || !register) return existing ?? null;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; error?: string; sent?: number }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; sent?: number };
    return res.ok ? { ok: true, sent: data.sent } : { ok: false, error: data.error ?? "L'opération a échoué." };
  } catch {
    return { ok: false, error: "Hors ligne : impossible de joindre le serveur." };
  }
}

async function detect(): Promise<PushState> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-browser";
  if (!supported) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await getRegistration(false);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export function NotificationsSection() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void detect()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);
  useEffect(refresh, [refresh]);

  async function enable() {
    setError(null);
    setBusy("toggle");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await getRegistration(true);
      if (!reg) throw new Error("no-sw");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
      const res = await postJson("/api/push/subscribe", sub.toJSON());
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setError(res.error ?? null);
        setState("off");
        return;
      }
      haptic("success");
      setState("on");
    } catch {
      setError("Impossible d'activer les notifications sur ce navigateur.");
      setState("off");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setError(null);
    setBusy("toggle");
    try {
      const reg = await getRegistration(false);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await postJson("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Impossible de désactiver les notifications.");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setError(null);
    setBusy("test");
    const res = await postJson("/api/push/test");
    setBusy(null);
    if (!res.ok) return setError(res.error ?? null);
    toast(res.sent && res.sent > 1 ? `Notification d'essai envoyée à ${res.sent} appareils` : "Notification d'essai envoyée");
  }

  return (
    <SettingsSection id="notifications" title="Notifications" description="Sur cet appareil seulement. Chaque appareil s'active séparément.">
      <Panel>
        {state === "checking" ? (
          <div aria-busy className="flex min-h-11 items-center justify-between gap-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton shape="pill" className="h-6 w-10" />
          </div>
        ) : state === "on" || state === "off" ? (
          <div className="flex flex-col gap-3">
            <Switch
              label="Notifications sur cet appareil"
              description={state === "on" ? "Activées." : "Désactivées."}
              checked={state === "on"}
              disabled={busy !== null}
              onCheckedChange={(on) => void (on ? enable() : disable())}
            />
            {state === "on" ? (
              <div>
                <Button variant="secondary" size="sm" loading={busy === "test"} onClick={test}>
                  Envoyer une notification d&apos;essai
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-base text-pretty text-fg-muted">
            {state === "ios-browser"
              ? "Sur iPhone et iPad, les notifications fonctionnent seulement quand Chez Nous est installé : dans Safari, touche Partager, puis « Sur l'écran d'accueil », et ouvre l'app depuis son icône."
              : state === "unconfigured"
                ? "Notifications non configurées sur ce serveur."
                : state === "denied"
                  ? "Les notifications sont bloquées pour ce site. Autorise-les dans les réglages de ton navigateur, puis reviens ici."
                  : "Ce navigateur ne prend pas en charge les notifications web."}
          </p>
        )}
        {error ? (
          <div className="mt-3">
            <InlineError>{error}</InlineError>
          </div>
        ) : null}
      </Panel>
    </SettingsSection>
  );
}
