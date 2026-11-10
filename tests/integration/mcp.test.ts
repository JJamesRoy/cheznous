import { describe, expect, it, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST, GET } from "@/app/api/mcp/route";
import { GET as PRM } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { createCouple, type Couple } from "./fixtures";
import { oauthAccessToken } from "./oauth";
import { run } from "./helpers";
import * as balances from "@/server/usecases/balances";
import * as expenses from "@/server/usecases/expenses";

const MCP_URL = "http://localhost:3000/api/mcp";

/** Route the SDK client's HTTP calls straight into our Next route handler. */
const routeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input instanceof Request ? input : String(input), init);
  return req.method === "GET" ? GET(req) : POST(req);
};

async function connect(token: string) {
  const client = new Client({ name: "chez-nous-tests", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: routeFetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

type Structured = Record<string, unknown> & { error?: { code: string; message: string } };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: !!res.isError, data: res.structuredContent as Structured };
}

describe("MCP server over Streamable HTTP with OAuth 2.1", () => {
  let c: Couple;
  let token: string;
  let client: Client;

  beforeAll(async () => {
    c = await createCouple(["Camille", "Alex"]);
    ({ accessToken: token } = await oauthAccessToken(c.a));
    client = await connect(token);
  });

  it("serves Protected Resource Metadata pointing at the Supabase authorization server", async () => {
    const meta = await (await PRM()).json();
    expect(meta.resource).toBe(MCP_URL);
    expect(meta.authorization_servers).toEqual([`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`]);
  });

  it("rejects missing, forged and non-OAuth tokens with a WWW-Authenticate challenge", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const none = await POST(new Request(MCP_URL, { method: "POST", headers, body }));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"');
    const forged = await POST(new Request(MCP_URL, { method: "POST", headers: { ...headers, authorization: "Bearer abc.def.ghi" }, body }));
    expect(forged.status).toBe(401);
    // A regular app session token (no client_id claim) is not accepted by default.
    const session = await POST(new Request(MCP_URL, { method: "POST", headers: { ...headers, authorization: `Bearer ${c.a.token}` }, body }));
    expect(session.status).toBe(401);
  });

  it("lists annotated tools and has no delete tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_household_context");
    expect(names).toContain("create_expense");
    expect(names.some((n) => n.startsWith("delete"))).toBe(false);
    const ctxTool = tools.find((t) => t.name === "get_household_context")!;
    expect(ctxTool.annotations?.readOnlyHint).toBe(true);
    const create = tools.find((t) => t.name === "create_expense")!;
    expect(create.annotations?.readOnlyHint).toBe(false);
    expect(create.inputSchema.properties).toHaveProperty("idempotency_key");
  });

  it("get_household_context says who 'me' is", async () => {
    const { data } = await call(client, "get_household_context");
    const hh = data.household as { me: string; members: { displayName: string; isMe: boolean }[] };
    expect(hh.me).toBe(c.a.id);
    expect(hh.members.find((m) => m.isMe)?.displayName).toBe("Camille");
  });

  it("« Ajoute une dépense de 85 $ chez Costco, payée par moi, divisée 50/50 » — retried with the same key creates one expense", async () => {
    const args = { amount: "85", description: "Costco", payer: "moi", split: { mode: "percentage", percentages: { moi: 50, Alex: 50 } }, category: "épicerie", idempotency_key: "claude-costco-85-0001" };
    const first = await call(client, "create_expense", args);
    expect(first.isError).toBe(false);
    const e = (first.data.expense as { id: string; amountCents: number; amount: string; splits: { shareCents: number }[] });
    expect(e.amountCents).toBe(8500);
    expect(e.amount).toMatch(/^85,00\s\$$/);
    expect(e.splits.map((s) => s.shareCents)).toEqual([4250, 4250]);
    const again = await call(client, "create_expense", args);
    expect(again.data.replayed).toBe(true);
    expect((again.data.expense as { id: string }).id).toBe(e.id);
    // The app (partner's session) sees exactly one.
    const list = await run(c.b, expenses.listExpenses, { search: "costco" });
    expect(list.expenses).toHaveLength(1);
  });

  it("« Qui doit combien à qui ? »", async () => {
    const { data } = await call(client, "get_balances");
    expect(data.sentence).toMatch(/^Alex te doit 42,50\s\$$/);
  });

  it("create_settlement without confirm only previews; with confirm records", async () => {
    const preview = await call(client, "create_settlement", {});
    expect(preview.data.status).toBe("preview");
    expect((await run(c.a, balances.getBalances, {})).me.amountCents).toBe(4250);
    const done = await call(client, "create_settlement", { confirm: true, idempotency_key: "settle-claude-0001" });
    expect(done.data.status).toBe("recorded");
    expect((await run(c.a, balances.getBalances, {})).me.kind).toBe("even");
  });

  it("ambiguous or unknown names give a clear error listing valid options", async () => {
    const r = await call(client, "create_expense", { amount: "10", description: "x", category: "Plomberie" });
    expect(r.isError).toBe(true);
    expect(r.data.error?.code).toBe("VALIDATION");
    expect(r.data.error?.message).toContain("Épicerie");
  });

  it("every tool call is audited (tool, args summary, status, latency)", async () => {
    const { data } = await c.a.db.from("mcp_tool_calls").select("tool, status, args_summary, latency_ms, client_id").order("id");
    expect(data!.length).toBeGreaterThanOrEqual(6);
    const create = data!.find((d) => d.tool === "create_expense")!;
    expect(create.args_summary.description).toMatch(/^<\d+ car\.>$/); // no free text stored
    expect(create.client_id).toBeTruthy();
    expect(data!.some((d) => d.status === "preview")).toBe(true);
    expect(data!.some((d) => d.status === "error")).toBe(true);
  });

  it("partner B cannot see A's tool-call log", async () => {
    const { data } = await c.b.db.from("mcp_tool_calls").select("id");
    expect(data).toEqual([]);
  });
});

describe("MCP: the eight reference questions, through the tools", () => {
  let c: Couple;
  let client: Client;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = today.slice(0, 7);
  const prev = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();

  beforeAll(async () => {
    c = await createCouple(["Camille", "Alex"]);
    client = await connect((await oauthAccessToken(c.b)).accessToken);
    await run(c.a, expenses.createExpense, { amount: "100", description: "IGA", category: "Épicerie" });
    await run(c.a, expenses.createExpense, { amount: "40", description: "Resto", category: "Resto", spentOn: `${prev}-10` });
  });

  it("exposes every tool from the brief", async () => {
    const { tools } = await client.listTools();
    const expected = [
      "get_household_context", "get_household_dashboard", "list_expenses", "get_expense", "create_expense", "update_expense",
      "get_balances", "create_settlement", "get_budget", "set_budget", "list_budgets", "get_spending_summary", "list_recurring_expenses",
      "list_upcoming_bills", "list_shopping_lists", "get_shopping_list", "add_shopping_item", "update_shopping_item",
      "mark_item_purchased", "list_tasks", "create_task", "update_task", "complete_task", "search_notes", "create_note",
      "get_note", "get_property_info", "list_property_documents", "list_maintenance_tasks", "get_key_dates",
      "get_mortgage_summary", "list_goals", "get_goal_progress",
    ];
    expect(tools.map((t) => t.name).sort()).toEqual([...expected].sort());
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf("boolean");
  });

  it("« Combien avons-nous dépensé en épicerie ce mois-ci ? »", async () => {
    const { data } = await call(client, "get_spending_summary", { category: "epicerie" });
    expect((data.period as { totalCents: number }).totalCents).toBe(10000);
  });

  it("« Ajoute des rideaux à 150 $ dans la liste Meubles » then « Qu'est-ce qu'on doit acheter pour le salon ? »", async () => {
    const add = await call(client, "add_shopping_item", { list: "Meubles", name: "Rideaux", unit_price: "150", idempotency_key: "rideaux-0000001" });
    expect(add.isError).toBe(false);
    await call(client, "add_shopping_item", { list: "Meubles", name: "Rideaux", unit_price: "150", idempotency_key: "rideaux-0000001" });
    const { data } = await call(client, "get_shopping_list", { list: "meubles" });
    const items = data.items as { name: string; unitPriceCents: number }[];
    expect(items).toEqual([expect.objectContaining({ name: "Rideaux", unitPriceCents: 15000 })]);
  });

  it("« Quelles sont nos tâches cette semaine ? »", async () => {
    await call(client, "create_task", { title: "Rappeler le gestionnaire", due_on: today, assignee: "Camille" });
    const { data } = await call(client, "list_tasks", { scope: "week" });
    expect((data.tasks as { title: string }[]).map((t) => t.title)).toEqual(["Rappeler le gestionnaire"]);
  });

  it("« Compare octobre et novembre »", async () => {
    const { data } = await call(client, "get_spending_summary", { month, compare_month: prev });
    const cmp = data.comparison as { totalCents: number; deltaCents: number };
    expect(cmp.totalCents).toBe(4000);
    expect(cmp.deltaCents).toBe(6000);
  });

  it("« C'est quand le renouvellement de l'hypothèque ? »", async () => {
    const none = await call(client, "get_mortgage_summary");
    expect(JSON.stringify(none.data)).toContain("hypothèque");
    await run(c.a, (await import("@/server/usecases/condo")).upsertMortgage, {
      lender: "Desjardins", originalPrincipal: "400000", rate: "4,79", rateType: "fixed", startDate: "2026-10-30",
      renewalDate: "2031-10-30", amortizationYears: 25, paymentFrequency: "monthly", prepaymentPrivilegePct: 15,
    });
    const { data, isError } = await call(client, "get_mortgage_summary");
    expect(isError).toBe(false);
    expect(JSON.stringify(data)).toContain("2031-10-30");
  });

  it("the dashboard answers in one call", async () => {
    const { data, isError } = await call(client, "get_household_dashboard");
    expect(isError).toBe(false);
    expect(data.balance).toBeTruthy();
    expect((data.month_budget as { spentCents: number }).spentCents).toBe(10000);
  });
});
