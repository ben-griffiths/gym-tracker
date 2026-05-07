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
  DEFAULT_USER_WEIGHT_UNIT,
  USER_WEIGHT_UNIT_STORAGE_KEY,
  type UserWeightUnit,
  parseUserWeightUnit,
  readUserWeightUnitFromStorage,
} from "@/lib/user-weight-unit";

export const LIFTLOG_WEIGHT_UNIT_CHANGE_EVENT = "liftlog-user-weight-unit-change";

type UserWeightUnitContextValue = {
  weightUnit: UserWeightUnit;
  setWeightUnit: (unit: UserWeightUnit) => void;
};

const UserWeightUnitContext = createContext<UserWeightUnitContextValue | null>(
  null,
);

export function UserWeightUnitProvider({ children }: { children: ReactNode }) {
  const [weightUnit, setWeightUnitState] = useState<UserWeightUnit>(
    DEFAULT_USER_WEIGHT_UNIT,
  );

  useEffect(() => {
    setWeightUnitState(readUserWeightUnitFromStorage());

    function onStorage(event: StorageEvent) {
      if (event.key !== USER_WEIGHT_UNIT_STORAGE_KEY) return;
      setWeightUnitState(parseUserWeightUnit(event.newValue));
    }

    function onLocalChange() {
      setWeightUnitState(readUserWeightUnitFromStorage());
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(LIFTLOG_WEIGHT_UNIT_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        LIFTLOG_WEIGHT_UNIT_CHANGE_EVENT,
        onLocalChange,
      );
    };
  }, []);

  const setWeightUnit = useCallback((next: UserWeightUnit) => {
    try {
      localStorage.setItem(USER_WEIGHT_UNIT_STORAGE_KEY, next);
    } catch {
      /* quota / privacy mode — still update React state */
    }
    setWeightUnitState(next);
    window.dispatchEvent(new Event(LIFTLOG_WEIGHT_UNIT_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    (): UserWeightUnitContextValue => ({ weightUnit, setWeightUnit }),
    [weightUnit, setWeightUnit],
  );

  return (
    <UserWeightUnitContext.Provider value={value}>
      {children}
    </UserWeightUnitContext.Provider>
  );
}

export function useUserWeightUnit(): UserWeightUnitContextValue {
  const ctx = useContext(UserWeightUnitContext);
  if (!ctx) {
    throw new Error(
      "useUserWeightUnit must be used within UserWeightUnitProvider",
    );
  }
  return ctx;
}
