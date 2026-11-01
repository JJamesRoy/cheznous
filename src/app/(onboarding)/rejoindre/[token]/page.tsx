import type { Metadata } from "next";
import { AuthFrame } from "@/features/auth/auth-frame";
import { JoinInvitation } from "@/features/onboarding/join-invitation";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthFrame brandHref={null}>
      <JoinInvitation token={decodeURIComponent(token)} />
    </AuthFrame>
  );
}
