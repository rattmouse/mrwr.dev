"use client";

import React from "react";
import { usePower } from "./PowerProvider";
import PoweredOffScreen from "@/components/power/PoweredOffScreen";
import ShuttingDownScreen from "@/components/power/ShuttingDownScreen";
import BootingScreen from "@/components/power/BootingScreen";

export default function PowerGate({ version }: { version: string }) {
  const { state } = usePower();

  if (state === "shuttingDown") return <ShuttingDownScreen version={version} />;
  if (state === "off") return <PoweredOffScreen />;
  if (state === "booting") return <BootingScreen version={version} />;

  return null;
}
