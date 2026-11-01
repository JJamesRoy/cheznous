import type { Metadata } from "next";
import { CapitalSection } from "@/features/condo/capital";

export const metadata: Metadata = { title: "Apport" };

export default function Page() {
  return <CapitalSection />;
}
