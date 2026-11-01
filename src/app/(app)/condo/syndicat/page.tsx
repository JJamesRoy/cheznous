import type { Metadata } from "next";
import { SyndicateSection } from "@/features/condo/syndicate";

export const metadata: Metadata = { title: "Syndicat et frais" };

export default function Page() {
  return <SyndicateSection />;
}
