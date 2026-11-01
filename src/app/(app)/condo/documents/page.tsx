import type { Metadata } from "next";
import { DocumentsSection } from "@/features/condo/documents";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
  return <DocumentsSection />;
}
