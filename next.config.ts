import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components disabled on purpose: see docs/DECISIONS.md (D3).
  reactStrictMode: true,
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
