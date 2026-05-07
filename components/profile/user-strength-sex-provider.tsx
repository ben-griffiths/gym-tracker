"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_USER_STRENGTH_SEX,
  USER_STRENGTH_SEX_STORAGE_KEY,
  type UserStrengthSex,
  parseUserStrengthSex,
  readUserStrengthSexFromStorage,
} from "@/lib/user-strength-sex";

export const LIFTLOG_STRENGTH_SEX_CHANGE_EVENT = "liftlog-user-strength-sex-change";

type UserStrengthSexContextValue = {
  strengthSex: UserStrengthSex;
  setStrengthSex: (sex: UserStrengthSex) => void;
};

const UserStrengthSexContext = createContext<UserStrengthSexContextValue | null>(
  null,
);

export function UserStrengthSexProvider({ children }: { children: ReactNode }) {
  const [strengthSex, setStrengthSexState] = useState<UserStrengthSex>(
    DEFAULT_USER_STRENGTH_SEX,
  );

  useEffect(() => {
    setStrengthSexState(readUserStrengthSexFromStorage());

    function onStorage(event: StorageEvent) {
      if (event.key !== USER_STRENGTH_SEX_STORAGE_KEY) return;
      setStrengthSexState(parseUserStrengthSex(event.newValue));
    }

    function onLocalChange() {
      setStrengthSexState(readUserStrengthSexFromStorage());
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(LIFTLOG_STRENGTH_SEX_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LIFTLOG_STRENGTH_SEX_CHANGE_EVENT, onLocalChange);
    };
  }, []);

  const setStrengthSex = useCallback((next: UserStrengthSex) => {
    try {
      localStorage.setItem(USER_STRENGTH_SEX_STORAGE_KEY, next);
    } catch {
      /* quota / privacy mode — still update React state */
    }
    setStrengthSexState(next);
    window.dispatchEvent(new Event(LIFTLOG_STRENGTH_SEX_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    (): UserStrengthSexContextValue => ({ strengthSex, setStrengthSex }),
    [strengthSex, setStrengthSex],
  );

  return (
    <UserStrengthSexContext.Provider value={value}>
      {children}
    </UserStrengthSexContext.Provider>
  );
}

export function useUserStrengthSex(): UserStrengthSexContextValue {
  const ctx = useContext(UserStrengthSexContext);
  if (!ctx) {
    throw new Error("useUserStrengthSex must be used within UserStrengthSexProvider");
  }
  return ctx;
}
