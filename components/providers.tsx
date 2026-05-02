"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@teispace/next-themes";
import { ReactNode, useState } from "react";
import { ThemeFavicon } from "@/components/layout/theme-favicon";
import { Toaster } from "@/components/ui/sonner";
import { WebllmProvider } from "@/components/webllm/webllm-provider";
import { WebllmInstallOverlay } from "@/components/webllm/webllm-install-overlay";
import { SyncProvider } from "@/components/sync/sync-provider";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storage="local"
        storageKey="liftlog-theme"
        disableTransitionOnChange
      >
        <ThemeFavicon />
        <SyncProvider>
          <WebllmProvider>
            {children}
            <WebllmInstallOverlay />
          </WebllmProvider>
        </SyncProvider>
        <Toaster richColors position="top-center" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
