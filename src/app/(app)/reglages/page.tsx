import type { Metadata } from "next";
import { SettingsPage } from "@/features/settings/settings-page";

export const metadata: Metadata = { title: "Réglages" };

export default function Page() {
  return <SettingsPage />;
}
