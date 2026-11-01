import type { Metadata } from "next";
import { NewPasswordForm } from "@/features/auth/new-password-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <NewPasswordForm next={typeof sp.next === "string" ? sp.next : null} />;
}
