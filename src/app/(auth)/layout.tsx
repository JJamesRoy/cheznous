import { AuthFrame } from "@/features/auth/auth-frame";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame brandHref={null}>{children}</AuthFrame>;
}
