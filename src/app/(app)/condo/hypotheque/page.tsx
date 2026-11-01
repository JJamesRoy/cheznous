import type { Metadata } from "next";
import { MortgageSection } from "@/features/condo/mortgage";

export const metadata: Metadata = { title: "Hypothèque" };

export default function Page() {
  return <MortgageSection />;
}
