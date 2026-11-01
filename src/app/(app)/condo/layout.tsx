import type { Metadata } from "next";
import { CondoFrame } from "@/features/condo/condo-frame";

export const metadata: Metadata = { title: { template: "%s · Condo · Chez Nous", default: "Condo" } };

export default function CondoLayout({ children }: { children: React.ReactNode }) {
  return <CondoFrame>{children}</CondoFrame>;
}
