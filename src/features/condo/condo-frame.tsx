"use client";

import { PageHeader } from "@/components/shell";
import { CondoNav } from "./condo-nav";

export function CondoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title="Condo" description="Hypothèque, syndicat, documents et entretien de votre unité." className="pb-0 print:hidden" />
      <CondoNav />
      {children}
    </div>
  );
}
