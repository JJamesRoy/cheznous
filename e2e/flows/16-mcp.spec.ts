import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { accessToken, couple } from "../support";
import { oauthAccessToken } from "../../tests/integration/oauth";

/**
 * Flows 16, 17, 18, 20 against the running server over real HTTP:
 * an OAuth-authenticated MCP client reads household data, creates an expense, the partner sees it
 * appear live in the app, and a duplicate call with the same idempotency key creates nothing new.
 */
test("MCP client (OAuth) reads, creates an expense that appears live, and retries idempotently", async ({ browser, baseURL }) => {
  const c = await couple(browser);
  const { accessToken: token } = await oauthAccessToken({ token: await accessToken(c.a) });

  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));

  // 16. Reads household data
  const ctx = await client.callTool({ name: "get_household_context", arguments: {} });
  const hh = (ctx.structuredContent as { household: { members: { displayName: string; isMe: boolean }[] } }).household;
  expect(hh.members.map((m) => m.displayName).sort()).toEqual([c.a.name, c.b.name].sort());

  // Partner B is watching the expenses list.
  await c.pageB.goto("/depenses");
  await expect(c.pageB.getByText("Costco (Claude)")).toHaveCount(0);

  // 17. Creates an expense
  const args = { amount: "85", description: "Costco (Claude)", payer: "moi", split: { mode: "percentage", percentages: { moi: 50, [c.b.name]: 50 } }, idempotency_key: `e2e-${Date.now()}` };
  const first = await client.callTool({ name: "create_expense", arguments: args });
  expect(first.isError).toBeFalsy();

  // 18. It appears live in the app (no reload)
  await expect(c.pageB.getByText("Costco (Claude)").first()).toBeVisible({ timeout: 15_000 });

  // 20. Same idempotency key → nothing new
  const again = await client.callTool({ name: "create_expense", arguments: args });
  expect((again.structuredContent as { replayed: boolean }).replayed).toBe(true);
  const list = await client.callTool({ name: "list_expenses", arguments: { search: "costco" } });
  expect((list.structuredContent as { expenses: unknown[] }).expenses).toHaveLength(1);
  await c.pageB.reload();
  await expect(c.pageB.getByText("Costco (Claude)")).toHaveCount(1);

  const bal = await client.callTool({ name: "get_balances", arguments: {} });
  expect((bal.structuredContent as { sentence: string }).sentence).toMatch(new RegExp(`^${c.b.name} te doit 42,50\\s\\$$`));
  await client.close();
  await c.close();
});
