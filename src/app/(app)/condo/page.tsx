import type { Metadata } from "next";
import { CondoOverview } from "@/features/condo/overview";

export const metadata: Metadata = { title: "Condo" };

export default function CondoPage() {
  return <CondoOverview />;
}
