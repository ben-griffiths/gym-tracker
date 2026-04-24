import type { MetadataRoute } from "next";

// Hex values approximate :root in app/globals.css (manifest cannot use CSS variables).
// If light theme tokens change materially, update background_color / theme_color to match.
const BACKGROUND = "#ffffff"; // --background oklch(1 0 0)
const THEME = "#242424"; // --primary oklch(0.205 0 0) ≈ dark gray

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LiftLog",
    short_name: "LiftLog",
    description:
      "Mobile-first gym tracker with camera recognition, one-tap set logging, and chat assistance.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND,
    theme_color: THEME,
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
