import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "Système de design",
  robots: { index: false, follow: false },
};

/** Dev-only gallery of every UI primitive, used for visual QA screenshots. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
