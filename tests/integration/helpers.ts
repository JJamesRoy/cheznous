import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTokenSupabase } from "@/lib/supabase/token";
import { buildCtx, type Ctx } from "@/server/ctx";
import { execute, type OpDef } from "@/server/op";
import type { z } from "zod";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!URL?.includes("127.0.0.1") && !URL?.includes("localhost")) {
  throw new Error("Integration tests only run against a local Supabase.");
}

export type TestUser = { id: string; email: string; password: string; token: string; db: SupabaseClient; name: string };

let counter = 0;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Sign up a fresh user through the public Auth API (email confirmation is off locally). */
export async function createUser(name = "Test"): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.${runId}.${++counter}@test.cheznous.local`;
  const password = `Pw-${runId}-${counter}-ok!`;
  const anon = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signUp({ email, password, options: { data: { display_name: name } } });
  if (error || !data.session) throw new Error(`signUp failed: ${error?.message ?? "no session"}`);
  return { id: data.user!.id, email, password, token: data.session.access_token, db: getTokenSupabase(data.session.access_token), name };
}

export async function ctxFor(user: TestUser): Promise<Ctx> {
  return buildCtx(user.db, { source: "test", claims: { sub: user.id, email: user.email } });
}

/** Run an op as `user` exactly like the app RPC route does. */
export async function run<I extends z.ZodType, O>(user: TestUser, op: OpDef<I, O>, input: z.input<I>): Promise<O> {
  return execute(op, await ctxFor(user), input);
}

export async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c !== code) throw new Error(`expected error ${code}, got ${c}: ${(e as Error).message}`);
    return e;
  }
  throw new Error(`expected error ${code}, but the call succeeded`);
}
