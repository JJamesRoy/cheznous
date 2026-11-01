import type { Metadata } from "next";
import { BudgetScreen } from "@/features/budget/budget-screen";

export const metadata: Metadata = { title: "Budget" };

export default function BudgetPage() {
  return <BudgetScreen />;
}
