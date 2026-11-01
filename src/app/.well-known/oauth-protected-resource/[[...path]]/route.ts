import { resourceUrl } from "@/mcp/auth";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint. */
export function GET() {
  return Response.json(
    {
      resource: resourceUrl(),
      authorization_servers: [serverEnv.authIssuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
      resource_name: "Chez Nous",
      resource_documentation: "https://github.com/JJamesRoy/cheznous/blob/main/docs/MCP.md",
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "*" } });
}
