"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ApiError, callOp, type OpInput, type OpName, type OpOutput } from "./api";
import { flushQueue, getQueueSnapshot, getServerQueueSnapshot, loadQueue, subscribeQueue } from "./offline-queue";

/** Query keys whose last-viewed data is kept on the device for offline reading. */
const PERSISTED_OPS = new Set<string>(["session.get", "dashboard.get", "balances.get", "shopping.lists", "shopping.list", "budget.get"]);

export const opKey = <N extends OpName>(name: N, input?: OpInput<N>) => (input === undefined ? ["op", name] : ["op", name, input]);

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 24 * 60 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
        networkMode: "offlineFirst",
      },
      mutations: { networkMode: "always" },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  // On the server (or with storage blocked) `storage` is undefined and the persister is a no-op,
  // so server and client render the same tree.
  const [persister] = useState(() =>
    createSyncStoragePersister({ storage: safeLocalStorage(), key: "cn-cache-v1", throttleTime: 1000 }),
  );

  useEffect(() => {
    void loadQueue().then(() => {
      if (navigator.onLine) void flushQueue(() => client.invalidateQueries({ queryKey: ["op"] }));
    });
    const onOnline = () => void flushQueue(() => client.invalidateQueries({ queryKey: ["op"] }));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [client]);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60_000,
        buster: "v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === "success" && PERSISTED_OPS.has(String(q.queryKey[1])),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function useOp<N extends OpName>(
  name: N,
  input: OpInput<N>,
  options?: Omit<UseQueryOptions<OpOutput<N>, ApiError>, "queryKey" | "queryFn">,
) {
  return useQuery<OpOutput<N>, ApiError>({
    queryKey: opKey(name, input),
    queryFn: ({ signal }) => callOp(name, input, { signal }),
    ...options,
  });
}

export function useOpMutation<N extends OpName, C = unknown>(
  name: N,
  options?: Omit<UseMutationOptions<OpOutput<N>, ApiError, OpInput<N>, C>, "mutationFn"> & { invalidate?: OpName[] | "all" },
) {
  const qc = useQueryClient();
  const { invalidate = "all", onSettled, ...rest } = options ?? {};
  return useMutation<OpOutput<N>, ApiError, OpInput<N>, C>({
    mutationFn: (input) => callOp(name, input),
    onSettled: async (...args) => {
      if (invalidate === "all") await qc.invalidateQueries({ queryKey: ["op"] });
      else await Promise.all(invalidate.map((n) => qc.invalidateQueries({ queryKey: ["op", n] })));
      await onSettled?.(...args);
    },
    ...rest,
  });
}

export function usePendingWrites() {
  return useSyncExternalStore(subscribeQueue, getQueueSnapshot, getServerQueueSnapshot);
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
