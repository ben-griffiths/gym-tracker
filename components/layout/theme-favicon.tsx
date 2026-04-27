"use client";

import { useTheme } from "@teispace/next-themes";
import { useEffect } from "react";

const LIGHT = "/favicon-light.svg";
const DARK = "/favicon-dark.svg";

function faviconHref(resolvedTheme: string | undefined): string {
  if (resolvedTheme === "dark") return DARK;
  if (resolvedTheme === "light") return LIGHT;
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return DARK;
  }
  return LIGHT;
}

/**
 * Safari (and others) ignore `<style>@media (prefers-color-scheme)` inside SVG favicons.
 * Swap `link[rel="icon"]` href from resolved theme instead.
 */
export function ThemeFavicon() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const href = faviconHref(resolvedTheme);
    const link =
      document.querySelector<HTMLLinkElement>(
        'link[rel="icon"][href*="favicon-light.svg"]',
      ) ??
      document.querySelector<HTMLLinkElement>(
        'link[rel="icon"][href*="favicon-dark.svg"]',
      ) ??
      document.querySelector<HTMLLinkElement>(
        'link[rel="icon"][type="image/svg+xml"]',
      );
    if (link) {
      try {
        link.href = new URL(href, window.location.origin).href;
      } catch {
        link.setAttribute("href", href);
      }
    }
  }, [resolvedTheme]);

  return null;
}
