import type { AnyOp } from "./op";
import * as household from "./usecases/household";
import * as expenses from "./usecases/expenses";
import * as balances from "./usecases/balances";

/**
 * Every operation of the app. The app RPC route (/api/ops/[op]) and the MCP server
 * both dispatch through this registry — there is no other path to business logic.
 */
const modules = [household, expenses, balances];

export const ops: Record<string, AnyOp> = Object.fromEntries(
  modules.flatMap((m) =>
    Object.values(m)
      .filter((v): v is AnyOp => !!v && typeof v === "object" && "name" in v && "run" in v && "input" in v)
      .map((op) => [op.name, op]),
  ),
);

export type OpName = keyof typeof ops;
