"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AppHeaderCenterContextValue = {
  customTitle: string | null;
  setCustomTitle: (value: string | null) => void;
};

const AppHeaderCenterContext =
  createContext<AppHeaderCenterContextValue | null>(null);

export function AppHeaderCenterProvider({ children }: { children: ReactNode }) {
  const [customTitle, setCustomTitleState] = useState<string | null>(null);
  const setCustomTitle = useCallback((value: string | null) => {
    setCustomTitleState(value);
  }, []);
  const value = useMemo(
    () => ({ customTitle, setCustomTitle }),
    [customTitle, setCustomTitle],
  );
  return (
    <AppHeaderCenterContext.Provider value={value}>
      {children}
    </AppHeaderCenterContext.Provider>
  );
}

export function useAppHeaderCenter(): AppHeaderCenterContextValue {
  const ctx = useContext(AppHeaderCenterContext);
  if (!ctx) {
    throw new Error(
      "useAppHeaderCenter must be used within AppHeaderCenterProvider",
    );
  }
  return ctx;
}
