import type { Metadata } from "next";
import { AuthFrame } from "@/features/auth/auth-frame";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";

export const metadata: Metadata = { title: "Bienvenue" };

export default function WelcomePage() {
  return (
    <AuthFrame width="wide" brandHref={null} aside={<SignOutButton className="-mr-2 text-fg-muted" />}>
      <OnboardingFlow />
    </AuthFrame>
  );
}
