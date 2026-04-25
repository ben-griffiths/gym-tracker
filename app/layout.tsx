import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/layout/app-header";
import { AppHeaderCenterProvider } from "@/components/layout/app-header-center-context";
import { AppScrollArea } from "@/components/layout/app-scroll-area";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#252525" },
  ],
};

export const metadata: Metadata = {
  title: "LiftLog",
  description:
    "Mobile-first gym tracker with camera recognition, one-tap set logging, and chat assistance.",
  applicationName: "LiftLog",
  appleWebApp: {
    capable: true,
    title: "LiftLog",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-dvh flex-col overflow-hidden bg-background">
        <Providers>
          <AppHeaderCenterProvider>
            <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
              <AppHeader />
              <AppScrollArea>{children}</AppScrollArea>
            </div>
          </AppHeaderCenterProvider>
        </Providers>
      </body>
    </html>
  );
}
