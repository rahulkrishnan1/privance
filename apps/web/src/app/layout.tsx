import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Schibsted_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SwUpdateBanner } from "@/components/SwUpdateBanner";
import { ThemeScript } from "@/components/ThemeScript";
import { AuthProvider } from "@/providers/auth-context";
import { QueryProvider } from "@/providers/query-client";
import { SyncProvider } from "@/providers/sync-context";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Privance",
  description: "Self-hosted, zero-knowledge personal finance",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Privance",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0f11",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${schibsted.variable} ${splineMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col">
        <ThemeScript />
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <SyncProvider>{children}</SyncProvider>
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
        <ServiceWorkerRegistration />
        <SwUpdateBanner />
      </body>
    </html>
  );
}
