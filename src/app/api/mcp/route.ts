import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/server";
import { TokenError, verifyAccessToken, wwwAuthenticate } from "@/mcp/auth";
import { buildCtx } from "@/server/ctx";
import { getTokenSupabase } from "@/lib/supabase/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function unauthorized(error: TokenError): Response {
  return withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: error.message }, id: null },
      { status: 401, headers: { "www-authenticate": wwwAuthenticate(error) } },
    ),
  );
}

/** Optional DNS-rebinding guard for browser-based clients (MCP spec: validate Origin). */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const allowed = process.env.MCP_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed?.length) return true;
  return allowed.includes(origin);
}

async function handle(request: Request): Promise<Response> {
  if (!originAllowed(request)) return withCors(new Response("Origine refusée", { status: 403 }));
  let token;
  try {
    token = await verifyAccessToken(request.headers.get("authorization"));
  } catch (e) {
    if (e instanceof TokenError) return unauthorized(e);
    throw e;
  }
  const db = getTokenSupabase(token.raw);
  const ctx = await buildCtx(db, { source: "mcp", clientId: token.clientId, claims: { sub: token.sub, email: token.email } });
  const server = createMcpServer(ctx);
  // Stateless: one transport per request, JSON responses (no long-lived SSE on serverless).
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    void server.close();
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  // No server-initiated stream in stateless mode, but unauthenticated probes still get the
  // 401 + WWW-Authenticate challenge so clients can discover the authorization server.
  try {
    await verifyAccessToken(request.headers.get("authorization"));
  } catch (e) {
    if (e instanceof TokenError) return unauthorized(e);
  }
  return withCors(new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }));
}

export async function DELETE() {
  return withCors(new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
