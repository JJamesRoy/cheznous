import { NextResponse } from "next/server";
import { ops } from "@/server/ops";
import { execute } from "@/server/op";
import { buildCtx } from "@/server/ctx";
import { AppError, httpStatusFor, serializeError } from "@/server/errors";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** App RPC: POST /api/ops/<name> with a JSON body. Same registry as the MCP server. */
export async function POST(request: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op: name } = await params;
  const op = ops[name];
  if (!op) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Opération inconnue." } }, { status: 404 });

  // CSRF: only same-origin JSON requests.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Origine refusée." } }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "JSON attendu." } }, { status: 415 });
  }

  try {
    const body = await request.json().catch(() => {
      throw new AppError("VALIDATION", "Corps JSON invalide.");
    });
    const db = await getServerSupabase();
    const ctx = await buildCtx(db, { source: "app" });
    const data = await execute(op, ctx, body);
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const error = serializeError(e);
    return NextResponse.json({ ok: false, error }, { status: httpStatusFor(error.code), headers: { "cache-control": "no-store" } });
  }
}
