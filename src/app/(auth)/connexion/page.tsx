import type { Metadata } from "next";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : null;
  return <SignInForm next={next} linkError={sp.erreur === "lien"} />;
}
