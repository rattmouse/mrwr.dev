"use client";

import React from "react";
import { usePower } from "./PowerProvider";
import PoweredOffScreen from "@/components/power/PoweredOffScreen";
import ShuttingDownScreen from "@/components/power/ShuttingDownScreen";
import BootingScreen from "@/components/power/BootingScreen";

export default function PowerGate() {
  const { state } = usePower();

  if (state === "shuttingDown") return <ShuttingDownScreen />;
  if (state === "off") return <PoweredOffScreen />;
  if (state === "booting") return <BootingScreen />;

  return null;
}
