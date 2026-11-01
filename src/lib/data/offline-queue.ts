"use client";

import { createStore, del, entries, set } from "idb-keyval";
import { ApiError, callOp, type OpInput, type OpName } from "./api";

/**
 * Offline writes, deliberately limited to adding an expense and adding / checking
 * shopping items. Each entry carries its idempotency key, so replaying it after a
 * flaky connection can never create a duplicate.
 */
export const OFFLINE_OPS = ["expenses.create", "shopping.addItem", "shopping.toggleItem"] as const;
export type OfflineOp = (typeof OFFLINE_OPS)[number];

export type QueuedWrite<N extends OfflineOp = OfflineOp> = {
  id: string;
  op: N;
  input: OpInput<N>;
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

const store = typeof indexedDB !== "undefined" ? createStore("chez-nous-offline", "writes") : undefined;
const listeners = new Set<() => void>();
let snapshot: QueuedWrite[] = [];

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeQueue(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getQueueSnapshot = () => snapshot;
export const getServerQueueSnapshot = (): QueuedWrite[] => [];

export async function loadQueue() {
  if (!store) return;
  const all = (await entries<string, QueuedWrite>(store)).map(([, v]) => v);
  snapshot = all.sort((a, b) => a.queuedAt - b.queuedAt);
  emit();
}

export function newIdempotencyKey() {
  return `cn-${crypto.randomUUID()}`;
}

export async function enqueue<N extends OfflineOp>(op: N, input: OpInput<N>): Promise<QueuedWrite<N>> {
  const w: QueuedWrite<N> = { id: crypto.randomUUID(), op, input, queuedAt: Date.now(), attempts: 0 };
  if (store) await set(w.id, w, store);
  snapshot = [...snapshot, w as unknown as QueuedWrite];
  emit();
  return w;
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Run an offline-capable op: online → call directly; offline or network failure → queue it.
 * Returns `{ queued: true }` when it was queued.
 */
export async function runOrQueue<N extends OfflineOp>(op: N, input: OpInput<N>) {
  if (!isOffline()) {
    try {
      return { queued: false as const, data: await callOp(op, input) };
    } catch (e) {
      if (!(e instanceof ApiError) || !e.isNetwork) throw e;
    }
  }
  const w = await enqueue(op, input);
  return { queued: true as const, write: w };
}

let flushing: Promise<number> | null = null;

/** Replay queued writes in order. Stops at the first network failure. Returns how many synced. */
export function flushQueue(onSynced?: (w: QueuedWrite) => void): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let done = 0;
    for (const w of [...snapshot]) {
      try {
        await callOp(w.op, w.input as never);
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) break;
        // A permanent error (validation, deleted list…): drop it but keep a trace for the UI.
        console.warn("[offline] dropped queued write", w.op, e);
      }
      if (store) await del(w.id, store);
      snapshot = snapshot.filter((x) => x.id !== w.id);
      done++;
      emit();
      onSynced?.(w);
    }
    return done;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
