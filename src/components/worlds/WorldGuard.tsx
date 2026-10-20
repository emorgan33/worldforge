"use client";

import { createContext, useContext, useEffect, useId, useMemo, type ReactNode } from "react";
import type { GuardRegistration } from "@/lib/navigation-guard";

type GuardState = NonNullable<GuardRegistration>;
type GuardContext = { register: (id: string, state: GuardRegistration) => void; paused: boolean };
const Context = createContext<GuardContext | null>(null);

export function WorldGuardProvider({ children, onGuardChange, paused }: {
  children: ReactNode; onGuardChange: GuardContext["register"]; paused: boolean;
}) {
  const value = useMemo(() => ({ register: onGuardChange, paused }), [onGuardChange, paused]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Portals retain this context, so nested image pickers and imports participate
 * in the same world boundary. Every mounted form has its own registration. */
export function useWorldGuard(state: GuardState, label: string, onChange?: (state: GuardRegistration) => void) {
  const context = useContext(Context);
  const id = `${label}:${useId()}`;
  const register = context?.register;
  const { dirty, busy } = state;
  useEffect(() => {
    if (onChange) onChange({ dirty, busy });
    else register?.(id, { dirty, busy });
    return () => { if (onChange) onChange(null); else register?.(id, null); };
  }, [id, register, onChange, dirty, busy]); // Scalar dependencies keep registrations stable.
  return context?.paused ?? false;
}

export function useWorldPaused() { return useContext(Context)?.paused ?? false; }
