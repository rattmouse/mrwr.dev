"use client";

import React, { useEffect, useRef } from "react";

const ANALYZER_ID = 1;

function normalizeSample(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v >= -1 && v <= 1) return v;
  return (v / 128) - 1;
}

export default function OscilloscopeWindow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestSamplesRef = useRef<Float32Array | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));
      sizeRef.current = { width: cssWidth, height: cssHeight };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(canvas);

    const onScopeData = (event: Event) => {
      const custom = event as CustomEvent<{ id?: number; samples?: ArrayLike<number> }>;
      if (custom.detail?.id !== ANALYZER_ID) return;
      const samples = custom.detail?.samples;
      if (!samples) return;
      latestSamplesRef.current = Float32Array.from(samples);
    };
    window.addEventListener("strudel-scope-data", onScopeData as EventListener);

    let raf = 0;
    const draw = (now: number) => {
      const { width: w, height: h } = sizeRef.current;

      ctx.fillStyle = "#0d1010";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(85, 110, 106, 0.26)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 10; i += 1) {
        const x = (w * i) / 10;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 1; i < 6; i += 1) {
        const y = (h * i) / 6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const timeData = latestSamplesRef.current;
      const hasSignal = !!timeData && timeData.length > 0;
      const mid = h / 2;

      ctx.strokeStyle = "rgba(0, 255, 186, 0.28)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      if (hasSignal) {
        const bufferSize = timeData.length;
        const samples = Array.from({ length: bufferSize }, (_, i) => normalizeSample(timeData[i] ?? 0));
        let triggerIndex = samples.findIndex((v, i, arr) => i > 0 && arr[i - 1] > 0 && v <= 0);
        if (triggerIndex < 0) triggerIndex = 0;
        const usable = Math.max(1, bufferSize - triggerIndex);
        for (let i = triggerIndex; i < bufferSize; i += 1) {
          const x = ((i - triggerIndex) / usable) * w;
          const y = mid - samples[i] * (h * 0.34);
          if (i === triggerIndex) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        const phase = now * 0.0024;
        const points = 120;
        for (let i = 0; i <= points; i += 1) {
          const x = (i / points) * w;
          const y =
            mid +
            Math.sin((i / points) * Math.PI * 4 + phase) * (h * 0.035) +
            Math.sin((i / points) * Math.PI * 9 + phase * 1.7) * (h * 0.015);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = "#00f2b1";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (hasSignal) {
        const bufferSize = timeData.length;
        const samples = Array.from({ length: bufferSize }, (_, i) => normalizeSample(timeData[i] ?? 0));
        let triggerIndex = samples.findIndex((v, i, arr) => i > 0 && arr[i - 1] > 0 && v <= 0);
        if (triggerIndex < 0) triggerIndex = 0;
        const usable = Math.max(1, bufferSize - triggerIndex);
        for (let i = triggerIndex; i < bufferSize; i += 1) {
          const x = ((i - triggerIndex) / usable) * w;
          const y = mid - samples[i] * (h * 0.34);
          if (i === triggerIndex) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        const phase = now * 0.0024;
        const points = 120;
        for (let i = 0; i <= points; i += 1) {
          const x = (i / points) * w;
          const y =
            mid +
            Math.sin((i / points) * Math.PI * 4 + phase) * (h * 0.035) +
            Math.sin((i / points) * Math.PI * 9 + phase * 1.7) * (h * 0.015);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(186, 255, 234, 0.88)";
      ctx.font = "11px monospace";
      ctx.fillText(hasSignal ? "OSCI: AUDIO" : "OSCI: IDLE", 8, 16);

      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      window.removeEventListener("strudel-scope-data", onScopeData as EventListener);
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        background: "#0d1010",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}
