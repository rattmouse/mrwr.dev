"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export type PaintWindowHandle = {
  clear: () => void;
};

type PaintWindowProps = {
  color: string;
  brushSize: number;
};

const BG = "#ffffff";

/**
 * A bare-bones MS Paint: one white sheet you draw on freehand with a pencil.
 * Colour and brush size are driven from the window toolbar; Clear wipes it back
 * to white. No layers, no shapes, no save — just scribbling.
 */
const PaintWindow = forwardRef<PaintWindowHandle, PaintWindowProps>(function PaintWindow(
  { color, brushSize },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  // Latest colour/size, readable from the pointer handlers without re-binding them.
  const styleRef = useRef({ color, brushSize });
  styleRef.current = { color, brushSize };

  // Fill the whole backing store white. Runs in identity transform, so it takes
  // device pixels, not CSS pixels.
  const fillBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }, []);

  // Match the backing store to the element size (× DPR) without wiping the drawing.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.floor(wrap.clientWidth));
    const cssH = Math.max(1, Math.floor(wrap.clientHeight));
    const nextW = Math.round(cssW * dpr);
    const nextH = Math.round(cssH * dpr);
    if (canvas.width === nextW && canvas.height === nextH) return;

    // Snapshot the current bitmap so growing/shrinking the window keeps the art.
    let snapshot: HTMLCanvasElement | null = null;
    if (canvas.width > 0 && canvas.height > 0) {
      snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    }

    canvas.width = nextW;
    canvas.height = nextH;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    fillBackground(ctx, nextW, nextH);
    if (snapshot) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(snapshot, 0, 0);
      ctx.restore();
    }
  }, [fillBackground]);

  useEffect(() => {
    resize();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [resize]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const strokeTo = (x: number, y: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { color: c, brushSize: s } = styleRef.current;
    const from = last.current;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = s;
    if (from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      // A lone click/tap still leaves a dot.
      ctx.beginPath();
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    last.current = { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = true;
    last.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    strokeTo(p.x, p.y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    strokeTo(p.x, p.y);
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        if (!canvas || !ctx) return;
        fillBackground(ctx, canvas.width, canvas.height);
      },
    }),
    [fillBackground],
  );

  return (
    <div
      ref={wrapRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        border: "2px solid",
        borderColor: "#808080 #ffffff #ffffff #808080",
        background: BG,
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        style={{ display: "block", touchAction: "none", cursor: "crosshair" }}
      />
    </div>
  );
});

export default PaintWindow;
