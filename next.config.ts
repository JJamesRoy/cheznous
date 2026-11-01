import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components disabled on purpose: see docs/DECISIONS.md (D3).
  reactStrictMode: true,
  // Lets several dev servers run side by side (parallel development / QA).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
