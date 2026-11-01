import type { Metadata } from "next";
import { Suspense } from "react";
import { ExpensesScreen } from "@/features/expenses/expenses-screen";

export const metadata: Metadata = { title: "Dépenses" };

export default function ExpensesPage() {
  // useSearchParams (detail sheet ?d=) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ExpensesScreen />
    </Suspense>
  );
}
