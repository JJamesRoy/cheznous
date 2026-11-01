import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { BOOT_SCRIPT, THEME_COLORS } from "@/lib/ui/boot-script";
import { Providers } from "./providers";
import { QueryProvider } from "@/lib/data/query";
import { ServiceWorker } from "@/features/app/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s · Chez Nous",
    default: "Chez Nous",
  },
  description:
    "Les dépenses, le budget, les listes, les tâches et le condo, à deux, au même endroit.",
  applicationName: "Chez Nous",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Chez Nous",
  },
  formatDetection: { telephone: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr-CA"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies saved theme / privacy / sidebar before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <QueryProvider>{children}</QueryProvider>
          <ServiceWorker />
        </Providers>
      </body>
    </html>
  );
}
