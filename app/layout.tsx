import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppHeader } from "@/components/layout/app-header";
import { AppHeaderCenterProvider } from "@/components/layout/app-header-center-context";
import { REQUEST_PATHNAME_HEADER } from "@/lib/supabase/middleware";
import { AppScrollArea } from "@/components/layout/app-scroll-area";
import { WorkoutReturnPathRecorder } from "@/components/layout/workout-return-path-recorder";
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

/** SVGs in /public; Safari ignores @media inside SVG when used as favicons — use link[media] pairs instead. */
const FAVICON_LIGHT = {
  url: "/favicon-light.svg",
  type: "image/svg+xml",
  media: "(prefers-color-scheme: light)",
} as const;
const FAVICON_DARK = {
  url: "/favicon-dark.svg",
  type: "image/svg+xml",
  media: "(prefers-color-scheme: dark)",
} as const;

export const metadata: Metadata = {
  title: "LiftLog",
  description:
    "Mobile-first gym tracker with camera recognition, one-tap set logging, and chat assistance.",
  applicationName: "LiftLog",
  /**
   * System appearance: `media` lets Safari/Chrome pick the right asset for light vs dark
   * without client JS (important for iOS Add to Home Screen, which snapshots icons from this document).
   *
   * iOS caveat: the home screen icon is often cached at install time; after changing assets, users may
   * need to remove the shortcut and add it again (or clear Safari data) to see updates.
   */
  colorScheme: "dark light",
  icons: {
    // Legacy .ico last resort (moved to /public so it is not auto-prepended ahead of themed SVGs).
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    icon: [FAVICON_LIGHT, FAVICON_DARK],
    apple: [
      { ...FAVICON_LIGHT, sizes: "180x180" },
      { ...FAVICON_DARK, sizes: "180x180" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "LiftLog",
    // Lets `theme-color` (viewport) tint the status area in standalone; pairs with media-specific theme-color.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const initialPathname = headerStore.get(REQUEST_PATHNAME_HEADER) ?? "/";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-dvh flex-col overflow-hidden bg-background">
        <Providers>
          <WorkoutReturnPathRecorder />
          <AppHeaderCenterProvider>
            <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
              <AppHeader initialPathname={initialPathname} />
              <AppScrollArea>{children}</AppScrollArea>
            </div>
          </AppHeaderCenterProvider>
        </Providers>
      </body>
    </html>
  );
}
