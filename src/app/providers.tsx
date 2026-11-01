"use client";

import { LucideProvider } from "lucide-react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { Tooltip } from "radix-ui";
import { Toaster } from "@/components/ui/toast";
import { PrivacyProvider } from "@/lib/ui/privacy";
import { ThemeProvider } from "@/lib/ui/theme";

/**
 * Layout/drag features (for `layoutId` sliding pills) are loaded after
 * hydration so the initial bundle only carries `domAnimation`.
 */
const loadExtraMotionFeatures = () => import("@/lib/ui/motion-features").then((mod) => mod.default);

/**
 * UI providers shared by every route.
 *
 * Data providers (e.g. QueryClientProvider) live in their own file and are
 * nested by the root layout around or inside this component:
 *
 *   <Providers>
 *     <QueryProvider>{children}</QueryProvider>   ← slot for other providers
 *   </Providers>
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PrivacyProvider>
        <LazyMotion features={domAnimation} strict>
          {/* Registers layout + drag globally once loaded; renders nothing. */}
          <LazyMotion features={loadExtraMotionFeatures}>{null}</LazyMotion>
          <MotionConfig reducedMotion="user">
            <LucideProvider strokeWidth={1.5}>
              <Tooltip.Provider delayDuration={400} skipDelayDuration={0}>
                {children}
                <Toaster />
              </Tooltip.Provider>
            </LucideProvider>
          </MotionConfig>
        </LazyMotion>
      </PrivacyProvider>
    </ThemeProvider>
  );
}
