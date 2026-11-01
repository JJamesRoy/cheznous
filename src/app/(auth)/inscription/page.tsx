import type { Metadata } from "next";
import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <SignUpForm next={typeof sp.next === "string" ? sp.next : null} />;
}
