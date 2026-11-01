import type { Metadata } from "next";
import { MaintenanceSection } from "@/features/condo/maintenance";

export const metadata: Metadata = { title: "Entretien" };

export default function Page() {
  return <MaintenanceSection />;
}
