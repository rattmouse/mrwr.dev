"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type PowerState = "on" | "shuttingDown" | "off" | "booting";

type PowerContextValue = {
  state: PowerState;
  shutdown: () => void;
  powerOn: () => void; // “reboot” (from off)
};

const PowerContext = createContext<PowerContextValue | null>(null);

const STORAGE_KEY = "mrwr:poweredOff";

export function PowerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PowerState>("on");
  const timerRef = useRef<number | null>(null);
  const refreshOnBootRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // On mount: if we were OFF previously, show BOOTING (not shutdown), then ON.
  useEffect(() => {
    try {
      const wasOff = localStorage.getItem(STORAGE_KEY) === "1";
      if (wasOff) {
        setState("booting");
      }
    } catch {
      // ignore
    }
    return () => clearTimer();
  }, []);

  // Persist only the *final off* state.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, state === "off" ? "1" : "0");
    } catch {
      // ignore
    }
  }, [state]);

  const shutdown = () => {
    // Only allow shutdown from ON
    if (state !== "on") return;

    setState("shuttingDown");
    clearTimer();
    // duration should match your shutdown animation length
    timerRef.current = window.setTimeout(() => {
      setState("off");
      timerRef.current = null;
    }, 2500);
  };

  const powerOn = () => {
    // Only allow “reboot” from OFF
    if (state !== "off") return;
    refreshOnBootRef.current = true;

    setState("booting");
    clearTimer();
  };

  // When booting is triggered by refresh (mount), auto-finish to ON
  useEffect(() => {
    if (state !== "booting") return;

    clearTimer();
    timerRef.current = window.setTimeout(() => {
      if (refreshOnBootRef.current) {
        refreshOnBootRef.current = false;
        window.location.reload();
        return;
      }
      setState("on");
      timerRef.current = null;
    }, 1800);
  }, [state]);

  const value = useMemo<PowerContextValue>(
    () => ({ state, shutdown, powerOn }),
    [state]
  );

  return <PowerContext.Provider value={value}>{children}</PowerContext.Provider>;
}

export function usePower() {
  const ctx = useContext(PowerContext);
  if (!ctx) throw new Error("usePower must be used within <PowerProvider />");
  return ctx;
}
