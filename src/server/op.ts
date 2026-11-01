import { z } from "zod";
import type { Ctx, HouseholdCtx } from "./ctx";
import { requireHousehold } from "./ctx";

export type OpKind = "read" | "write";

export type OpDef<I extends z.ZodType, O> = {
  name: string;
  kind: OpKind;
  /** Whether the op needs a household (almost all do). */
  household: boolean;
  /** Writes that may be queued offline and replayed (idempotency key required). */
  offline?: boolean;
  input: I;
  run: (ctx: HouseholdCtx, input: z.output<I>) => Promise<O>;
};

export type AnyOp = OpDef<z.ZodType, unknown>;

export function defineOp<I extends z.ZodType, O>(def: {
  name: string;
  kind: OpKind;
  household?: boolean;
  offline?: boolean;
  input: I;
  run: (ctx: HouseholdCtx, input: z.output<I>) => Promise<O>;
}): OpDef<I, O> {
  return { household: true, ...def };
}

/** Same as defineOp, for the few operations that run before a household exists. */
export function defineUserOp<I extends z.ZodType, O>(def: {
  name: string;
  kind: OpKind;
  input: I;
  run: (ctx: Ctx, input: z.output<I>) => Promise<O>;
}): OpDef<I, O> {
  return { ...def, household: false, run: def.run as (ctx: HouseholdCtx, input: z.output<I>) => Promise<O> };
}

/** Validate input and run. Single entry point used by the app RPC route, MCP and tests. */
export async function execute<I extends z.ZodType, O>(op: OpDef<I, O>, ctx: Ctx, rawInput: unknown): Promise<O> {
  const input = op.input.parse(rawInput ?? {});
  const scoped = op.household ? requireHousehold(ctx) : (ctx as HouseholdCtx);
  return op.run(scoped, input);
}
