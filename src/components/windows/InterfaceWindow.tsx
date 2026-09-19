"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import FloatingPanel from "@/components/windows/FloatingPanel";
import { emojiSprite } from "@/lib/emojiSprite";
import { GuySheet, loadGuys, tintGuys } from "@/lib/guys";

export type PanelId = "palette" | "motion" | "readout" | "frame";

/** What the Frame panel is doing to the window around this one: 0–1 of warp. */
export type FrameSettings = { melt: number };

const PANELS: { id: PanelId; label: string; title: string; width: number }[] = [
  { id: "palette", label: "Palette", title: "Palette", width: 258 },
  { id: "motion", label: "Motion", title: "Motion", width: 246 },
  { id: "readout", label: "Readout", title: "Readout", width: 214 },
  { id: "frame", label: "Frame", title: "Frame", width: 246 },
];

const ACCENTS = ["#5eead4", "#818cf8", "#f472b6", "#fbbf24", "#a3e635"] as const;
const SURFACES = [
  { label: "Ink", value: "#0b0e14" },
  { label: "Slate", value: "#161a23" },
  { label: "Mist", value: "#e7ebf2" },
] as const;

type NodeShape = "guys" | "rat" | "mouse" | "dots";

// The two emoji the canvas can be populated with instead of the painted crowd.
const EMOJI: Partial<Record<NodeShape, string>> = { rat: "🐀", mouse: "🐁" };
const SHAPE_NAMES: Record<NodeShape, string> = {
  guys: "guy",
  rat: "rat",
  mouse: "mouse",
  dots: "dot",
};

type Settings = {
  accent: string;
  surface: string;
  density: number;
  speed: number;
  reach: number;
  shape: NodeShape;
};

// What one node has been told to be, as against what the crowd around it is.
type NodeOverride = { shape?: NodeShape; color?: string };

// Which of the painted figures this node is, which way it faces and how big it
// is — rolled once when the node is born so a guy doesn't flicker into someone
// else every frame. The id is what selection and per-node edits hold on to,
// since the array itself shuffles as the density changes.
type Node = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  guy: number;
  flip: boolean;
  size: number;
};

const DEFAULTS: Settings = {
  accent: ACCENTS[0],
  surface: SURFACES[0].value,
  density: 46,
  speed: 0.5,
  reach: 120,
  shape: "guys",
};

// How tall a guy stands on the canvas, before his own size roll.
const GUY_HEIGHT = 26;

// How many opacity steps the links are drawn in. Five is under the threshold
// where the banding shows and well under the point where the draw calls hurt.
const LINK_STEPS = 5;
const bucketFor = (closeness: number) =>
  Math.max(0, Math.min(LINK_STEPS - 1, Math.floor(closeness * LINK_STEPS)));
const bucketAlpha = (index: number) => (index + 0.5) / LINK_STEPS;

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

// A light surface needs dark ink on it and the other way round; everything the
// canvas draws is one of these two plus the accent.
const isLight = (hex: string) => {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
};

// The palette is picked to glow on a dark canvas, which leaves it washed out on
// a pale one — so on Mist the same accent is taken down towards ink.
const deepen = (hex: string, amount: number) => {
  const [r, g, b] = channels(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

/**
 * interface.exe: a canvas of drifting nodes that reach for the pointer, with a
 * strip of menus along the top. Each menu opens a tool window that floats free
 * of this frame — they drag anywhere on the desktop and always sit above it —
 * and every control in them writes straight into what the canvas is drawing.
 *
 * The frame around it is the usual Windows 95 dressing; everything inside is
 * deliberately not.
 */
type InterfaceWindowProps = {
  frame: FrameSettings;
  onFrameChange: (frame: FrameSettings) => void;
};

export default function InterfaceWindow({ frame, onFrameChange }: InterfaceWindowProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  // Open panels, back to front: the last one is on top, and clicking any panel
  // moves it to the end.
  const [stack, setStack] = useState<PanelId[]>([]);
  const [stats, setStats] = useState({ fps: 0, nodes: 0, x: 0, y: 0 });
  // The node under the last click, and what has been done to individual nodes.
  // Both are kept in React state so the panels can show them, and mirrored into
  // refs so the draw loop can read them without re-subscribing.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, NodeOverride>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const pointerRef = useRef<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });
  // The draw loop reads settings through a ref so moving a slider never has to
  // tear down and restart the animation.
  const guysRef = useRef<GuySheet | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);
  const selectedRef = useRef<number | null>(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const nextNodeId = useRef(1);

  const openPanel = (id: PanelId) =>
    setStack((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  const focusPanel = useCallback(
    (id: PanelId) => setStack((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((p) => p !== id), id])),
    [],
  );
  const closePanel = useCallback((id: PanelId) => setStack((prev) => prev.filter((p) => p !== id)), []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  // With a node picked, the Palette's controls work on that one; with nothing
  // picked they work on the crowd, exactly as they did before. The controls
  // themselves are the same either way — they just show, and write, whichever
  // of the two is in scope.
  const selectedOverride = selectedId === null ? null : (overrides[selectedId] ?? {});
  const activeAccent = selectedOverride?.color ?? settings.accent;
  const activeShape = selectedOverride?.shape ?? settings.shape;
  const editSelected = (patch: NodeOverride) => {
    if (selectedId === null) return;
    setOverrides((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], ...patch } }));
  };
  const resetSelected = () => {
    if (selectedId === null) return;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  };
  const edited = Object.keys(overrides).length;

  // The sprite sheet is fetched the first time the canvas actually wants guys —
  // whether that is the whole crowd or a single node told to be one.
  const wantsGuys =
    settings.shape === "guys" || Object.values(overrides).some((o) => o.shape === "guys");
  useEffect(() => {
    if (!wantsGuys || guysRef.current) return;
    let cancelled = false;
    void loadGuys().then((sheet) => {
      if (!cancelled) guysRef.current = sheet;
    });
    return () => {
      cancelled = true;
    };
  }, [wantsGuys]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const previousWidth = width;
      const previousHeight = height;
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));

      // Carry the crowd with the canvas when the window is resized or
      // maximized, instead of leaving everyone huddled in the old corner.
      if (previousWidth > 0 && previousHeight > 0) {
        const scaleX = width / previousWidth;
        const scaleY = height / previousHeight;
        for (const node of nodesRef.current) {
          node.x *= scaleX;
          node.y *= scaleY;
        }
      }

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (count: number) => {
      const nodes = nodesRef.current;
      while (nodes.length > count) nodes.pop();
      while (nodes.length < count) {
        nodes.push({
          id: nextNodeId.current++,
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.random() * 2 - 1,
          vy: Math.random() * 2 - 1,
          guy: Math.floor(Math.random() * 1e6),
          flip: Math.random() < 0.5,
          size: 0.78 + Math.random() * 0.5,
        });
      }
    };

    // One reusable path per opacity step, for both the node-to-node links and
    // the ones reaching for the pointer.
    const makeBuckets = () =>
      Array.from({ length: LINK_STEPS }, () => ({
        path: new Path2D(),
        used: false,
        reset(this: { path: Path2D; used: boolean }) {
          this.path = new Path2D();
          this.used = false;
        },
        line(this: { path: Path2D; used: boolean }, x1: number, y1: number, x2: number, y2: number) {
          this.path.moveTo(x1, y1);
          this.path.lineTo(x2, y2);
          this.used = true;
        },
      }));
    const linkBuckets = makeBuckets();
    const pointerBuckets = makeBuckets();

    fit();
    spawn(DEFAULTS.density);

    const observer = new ResizeObserver(() => fit());
    observer.observe(wrap);

    let frame = 0;
    let last = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;
    let statsAt = last;

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      const dt = Math.min(now - last, 50);
      last = now;

      const { accent, surface, density, speed, reach, shape } = settingsRef.current;
      spawn(density);
      const nodes = nodesRef.current;
      const light = isLight(surface);
      const ink = light ? "15, 20, 30" : "232, 236, 244";
      const step = (dt / 16.67) * speed;

      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, width, height);

      for (const node of nodes) {
        node.x += node.vx * step;
        node.y += node.vy * step;
        // Wrap rather than bounce, so nothing piles up along the edges.
        if (node.x < -reach) node.x = width + reach;
        if (node.x > width + reach) node.x = -reach;
        if (node.y < -reach) node.y = height + reach;
        if (node.y > height + reach) node.y = -reach;
      }

      const pointer = pointerRef.current;
      ctx.lineWidth = 1;

      // Every link is its own colour, since it fades with distance — but a
      // stroke() per link is hundreds of draw calls a frame. Sorting them into
      // a handful of opacity steps costs nothing visible and collapses the lot
      // into one path per step.
      for (const bucket of linkBuckets) bucket.reset();
      for (const bucket of pointerBuckets) bucket.reset();
      const pointerReach = reach * 1.6;

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > reach * reach) continue;
          const closeness = 1 - Math.sqrt(distSq) / reach;
          linkBuckets[bucketFor(closeness)].line(a.x, a.y, b.x, b.y);
        }

        if (pointer.on) {
          const dist = Math.hypot(a.x - pointer.x, a.y - pointer.y);
          if (dist < pointerReach) {
            const closeness = 1 - dist / pointerReach;
            pointerBuckets[bucketFor(closeness)].line(a.x, a.y, pointer.x, pointer.y);
          }
        }
      }

      linkBuckets.forEach((bucket, index) => {
        if (!bucket.used) return;
        ctx.strokeStyle = `rgba(${ink}, ${bucketAlpha(index) * 0.24})`;
        ctx.stroke(bucket.path);
      });
      pointerBuckets.forEach((bucket, index) => {
        if (!bucket.used) return;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = bucketAlpha(index) * 0.55;
        ctx.stroke(bucket.path);
        ctx.globalAlpha = 1;
      });

      const sheet = guysRef.current;
      const nodeOverrides = overridesRef.current;
      // Each colour only has to be taken down for a pale surface once a frame,
      // however many nodes are wearing it.
      const tones = new Map<string, string>();
      const toneOf = (hex: string) => {
        let tone = tones.get(hex);
        if (!tone) {
          tone = light ? deepen(hex, 0.45) : hex;
          tones.set(hex, tone);
        }
        return tone;
      };

      for (const node of nodes) {
        const override = nodeOverrides[node.id];
        const nodeShape = override?.shape ?? shape;
        const tone = toneOf(override?.color ?? accent);
        const h = GUY_HEIGHT * node.size;
        const emoji = EMOJI[nodeShape];

        if (emoji) {
          const sprite = emojiSprite(emoji);
          if (!sprite) continue;
          ctx.save();
          ctx.translate(node.x, node.y);
          // Half of them face the other way, so the crowd isn't a chorus line.
          if (node.flip) ctx.scale(-1, 1);
          ctx.drawImage(sprite, -h / 2, -h / 2, h, h);
          ctx.restore();
        } else if (nodeShape === "guys" && sheet) {
          const guy = node.guy % sheet.count;
          const sx = (guy % sheet.columns) * sheet.cellWidth;
          const sy = Math.floor(guy / sheet.columns) * sheet.cellHeight;
          const w = h * (sheet.cellWidth / sheet.cellHeight);
          ctx.save();
          ctx.translate(node.x, node.y);
          if (node.flip) ctx.scale(-1, 1);
          ctx.drawImage(
            tintGuys(sheet, tone),
            sx,
            sy,
            sheet.cellWidth,
            sheet.cellHeight,
            -w / 2,
            -h / 2,
            w,
            h,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = tone;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // The picked node wears a marching-ants ring, in the palette's own colour
      // rather than its own, so it stands out however it has been dressed.
      const selected = selectedRef.current;
      if (selected !== null) {
        const node = nodes.find((n) => n.id === selected);
        if (node) {
          ctx.save();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = -((now / 45) % 8);
          ctx.beginPath();
          ctx.arc(node.x, node.y, (GUY_HEIGHT * node.size) / 2 + 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      fpsAccum += dt;
      fpsFrames += 1;
      if (now - statsAt > 250) {
        statsAt = now;
        const fps = fpsFrames > 0 ? Math.round(1000 / (fpsAccum / fpsFrames)) : 0;
        fpsAccum = 0;
        fpsFrames = 0;
        setStats({
          fps,
          nodes: nodes.length,
          x: Math.round(pointer.x),
          y: Math.round(pointer.y),
        });
        // Turning the density down can thin away the node that was picked.
        const picked = selectedRef.current;
        if (picked !== null && !nodes.some((n) => n.id === picked)) setSelectedId(null);
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const trackPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, on: true };
  };
  const dropPointer = () => {
    pointerRef.current = { ...pointerRef.current, on: false };
  };

  // Clicking the canvas picks the node under the pointer — its own size decides
  // how big a target it is — and clicking past everyone puts the panels back to
  // working on the whole crowd.
  const pickNode = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Node | null = null;
    let bestDistance = Infinity;
    for (const node of nodesRef.current) {
      const distance = Math.hypot(node.x - x, node.y - y);
      const radius = Math.max(14, (GUY_HEIGHT * node.size) / 2 + 5);
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    setSelectedId(best ? best.id : null);
  };

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 2,
        font: "13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <nav style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {PANELS.map((panel) => {
          const open = stack.includes(panel.id);
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => openPanel(panel.id)}
              aria-pressed={open}
              style={{
                appearance: "none",
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 13px",
                font: "inherit",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.01em",
                border: `1px solid ${open ? settings.accent : "rgba(15, 20, 30, 0.22)"}`,
                background: open ? settings.accent : "rgba(15, 20, 30, 0.05)",
                color: open ? "#0b0e14" : "#1b2130",
                transition: "background 120ms ease, border-color 120ms ease",
              }}
            >
              {panel.label}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(15, 20, 30, 0.5)" }}>
          {stack.length === 0 ? "no tools open" : `${stack.length} tool${stack.length > 1 ? "s" : ""} open`}
        </span>
      </nav>

      <div
        ref={wrapRef}
        onPointerMove={trackPointer}
        onPointerLeave={dropPointer}
        onPointerDown={pickNode}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          background: settings.surface,
          border: "1px solid rgba(15, 20, 30, 0.25)",
          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
          touchAction: "none",
          cursor: "crosshair",
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>

      {stack.map((id, index) => {
        const slot = PANELS.findIndex((p) => p.id === id);
        const panel = PANELS[slot];
        if (!panel) return null;
        return (
          <FloatingPanel
            key={id}
            title={panel.title}
            width={panel.width}
            initial={initialSpot(slot, panel.width)}
            stackIndex={index}
            onFocus={() => focusPanel(id)}
            onClose={() => closePanel(id)}
          >
            {id === "palette" && (
              <>
                <Scope
                  selected={selectedId !== null}
                  edited={edited}
                  onClear={() => setSelectedId(null)}
                  onReset={resetSelected}
                  hasOverride={Boolean(selectedOverride && Object.keys(selectedOverride).length > 0)}
                />
                <Field label="Accent">
                  <div style={{ display: "flex", gap: 7 }}>
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent}
                        type="button"
                        aria-label={accent}
                        aria-pressed={activeAccent === accent}
                        onClick={() =>
                          selectedId === null ? set("accent", accent) : editSelected({ color: accent })
                        }
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          cursor: "pointer",
                          background: accent,
                          border:
                            activeAccent === accent
                              ? "2px solid #fff"
                              : "2px solid rgba(255, 255, 255, 0.14)",
                        }}
                      />
                    ))}
                  </div>
                </Field>
                <Field label="Nodes">
                  <Segmented
                    options={[
                      { label: "Guys", value: "guys" },
                      { label: "🐀", value: "rat" },
                      { label: "🐁", value: "mouse" },
                      { label: "Dots", value: "dots" },
                    ]}
                    value={activeShape}
                    accent={settings.accent}
                    onChange={(value) =>
                      selectedId === null
                        ? set("shape", value as NodeShape)
                        : editSelected({ shape: value as NodeShape })
                    }
                  />
                </Field>
                <Field label="Surface">
                  <Segmented
                    options={SURFACES.map((s) => ({ label: s.label, value: s.value }))}
                    value={settings.surface}
                    accent={settings.accent}
                    onChange={(value) => set("surface", value)}
                  />
                </Field>
              </>
            )}

            {id === "motion" && (
              <>
                <Slider
                  label="Density"
                  value={settings.density}
                  min={8}
                  max={140}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => set("density", v)}
                />
                <Slider
                  label="Speed"
                  value={settings.speed}
                  min={0}
                  max={2}
                  step={0.05}
                  accent={settings.accent}
                  onChange={(v) => set("speed", v)}
                />
                <Slider
                  label="Reach"
                  value={settings.reach}
                  min={30}
                  max={260}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => set("reach", v)}
                />
              </>
            )}

            {id === "frame" && (
              <>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
                  Everything here works on the window around this one, not on the canvas.
                </p>
                <Slider
                  label="Warp"
                  value={Math.round(frame.melt * 100)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => onFrameChange({ melt: v / 100 })}
                />
                <button
                  type="button"
                  onClick={() => onFrameChange({ melt: 0 })}
                  style={{
                    cursor: "pointer",
                    borderRadius: 8,
                    border: "1px solid rgba(255, 255, 255, 0.16)",
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "#e8ecf4",
                    font: "inherit",
                    fontSize: 12,
                    padding: "8px 0",
                  }}
                >
                  Straighten up
                </button>
              </>
            )}

            {id === "readout" && (
              <div style={{ display: "grid", gap: 7 }}>
                <Stat label="Frames" value={`${stats.fps}/s`} accent={settings.accent} />
                <Stat label="Nodes" value={`${stats.nodes}`} accent={settings.accent} />
                <Stat label="Pointer" value={`${stats.x}, ${stats.y}`} accent={settings.accent} />
                <Stat
                  label="Picked"
                  value={selectedId === null ? "none" : `#${selectedId} · ${SHAPE_NAMES[activeShape]}`}
                  accent={settings.accent}
                />
                <Stat label="Edited" value={`${edited}`} accent={settings.accent} />
              </div>
            )}
          </FloatingPanel>
        );
      })}
    </div>
  );
}

// Each panel has its own slot down the right edge of the desktop, so opening two
// at once never lands one on top of the other and a panel you close and reopen
// comes back where you expect it. After that they go wherever you drag them.
function initialSpot(slot: number, width: number) {
  if (typeof window === "undefined") return { x: 420, y: 96 };
  const step = Math.max(120, Math.min(200, (window.innerHeight - 100) / PANELS.length));
  return {
    x: Math.max(16, window.innerWidth - width - 24),
    y: 66 + slot * step,
  };
}

/**
 * What the Palette is pointed at: the whole crowd, or the one node that was
 * clicked. Without saying so, a palette that suddenly only recolours one figure
 * reads as broken.
 */
function Scope({
  selected,
  edited,
  hasOverride,
  onClear,
  onReset,
}: {
  selected: boolean;
  edited: number;
  hasOverride: boolean;
  onClear: () => void;
  onReset: () => void;
}) {
  const pill: React.CSSProperties = {
    cursor: "pointer",
    borderRadius: 7,
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "#e8ecf4",
    font: "inherit",
    fontSize: 11,
    padding: "4px 9px",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        flexWrap: "wrap",
        padding: "8px 9px",
        borderRadius: 9,
        background: "rgba(255, 255, 255, 0.05)",
        fontSize: 12,
        color: "rgba(232, 236, 244, 0.7)",
      }}
    >
      <span style={{ flex: "1 1 auto" }}>
        {selected ? "Editing one node" : "Click a node to edit just that one"}
        {!selected && edited > 0 ? ` · ${edited} edited` : ""}
      </span>
      {selected && hasOverride && (
        <button type="button" style={pill} onClick={onReset}>
          Reset
        </button>
      )}
      {selected && (
        <button type="button" style={pill} onClick={onClear}>
          Done
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 7 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "rgba(232, 236, 244, 0.5)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Segmented({
  options,
  value,
  accent,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  accent: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        padding: 3,
        gap: 3,
        borderRadius: 9,
        background: "rgba(255, 255, 255, 0.06)",
      }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            style={{
              flex: 1,
              cursor: "pointer",
              borderRadius: 7,
              border: "none",
              padding: "5px 0",
              font: "inherit",
              fontSize: 12,
              background: on ? accent : "transparent",
              color: on ? "#0b0e14" : "rgba(232, 236, 244, 0.72)",
              transition: "background 120ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "rgba(232, 236, 244, 0.6)" }}>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: accent }}>
          {step < 1 ? value.toFixed(2) : value}
        </span>
      </span>
      <input
        type="range"
        className="ui-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "100%",
          height: 4,
          borderRadius: 999,
          outline: "none",
          cursor: "pointer",
          background: `linear-gradient(to right, ${accent} ${pct}%, rgba(255, 255, 255, 0.14) ${pct}%)`,
        }}
      />
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "7px 10px",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.05)",
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: "0.05em", color: "rgba(232, 236, 244, 0.55)" }}>
        {label}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: accent }}>{value}</span>
    </div>
  );
}
