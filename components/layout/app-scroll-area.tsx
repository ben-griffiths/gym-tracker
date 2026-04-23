"use client";

import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const AppScrollRootRefContext = createContext<RefObject<HTMLDivElement | null> | null>(
  null,
);

export function useAppScrollRootRef(): RefObject<HTMLDivElement | null> {
  const ref = useContext(AppScrollRootRefContext);
  if (!ref) {
    throw new Error("useAppScrollRootRef must be used within AppScrollArea");
  }
  return ref;
}

type AppScrollAreaProps = {
  children: ReactNode;
};

/** Full-bleed vertical scroll; horizontal padding is on an inner wrapper so the scrollbar stays at the viewport edge. */
export function AppScrollArea({ children }: AppScrollAreaProps) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  return (
    <AppScrollRootRefContext.Provider value={scrollRootRef}>
      <div
        ref={scrollRootRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
      >
        <div className="px-4 sm:px-6">{children}</div>
      </div>
    </AppScrollRootRefContext.Provider>
  );
}
