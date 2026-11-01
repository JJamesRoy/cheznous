/**
 * Lazily loaded Motion features (layout animations for `layoutId` sliding
 * pills, and drag). Loaded after hydration by a nested <LazyMotion> in
 * providers.tsx so the initial bundle only carries `domAnimation`.
 */
export { domMax as default } from "motion/react";
