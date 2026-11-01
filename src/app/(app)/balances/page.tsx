import type { Metadata } from "next";
import { BalancesScreen } from "@/features/balances/balances-screen";

export const metadata: Metadata = { title: "Balances" };

export default function BalancesPage() {
  return <BalancesScreen />;
}
