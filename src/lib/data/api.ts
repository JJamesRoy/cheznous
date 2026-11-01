import type { OpInput, OpName, OpOutput } from "@/server/ops";

export type { OpInput, OpName, OpOutput };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** True when the request never reached the server (offline, DNS, captive portal…). */
  get isNetwork() {
    return this.code === "NETWORK";
  }
}

/** Call a server op from the browser. Same registry as MCP; typed end to end. */
export async function callOp<N extends OpName>(name: N, input: OpInput<N>, init?: { signal?: AbortSignal }): Promise<OpOutput<N>> {
  let res: Response;
  try {
    res = await fetch(`/api/ops/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? {}),
      signal: init?.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("NETWORK", "Hors ligne : impossible de joindre le serveur.", 0);
  }
  let body: { ok: boolean; data?: unknown; error?: { code: string; message: string; details?: unknown } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status >= 500 ? "INTERNAL" : "NETWORK", "Réponse inattendue du serveur.", res.status);
  }
  if (!body.ok) throw new ApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? "Erreur", res.status, body.error?.details);
  return body.data as OpOutput<N>;
}
