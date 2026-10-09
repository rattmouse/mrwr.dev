"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "@/constants/zIndex";

/**
 * Anything on the menu: a wedge of the cross-section, or a choice on one of
 * the growth rings around it. One with a `ring` grows that ring outside it
 * when pointed at, the way a Windows menu opens a submenu; one without is
 * picked. `on` draws it pressed in: the current setting, or a layer that's
 * showing.
 */
export type RingNode = {
  label: string;
  /** The setting now, printed small under the label. */
  value?: string;
  title?: string;
  disabled?: boolean;
  on?: boolean;
  /** Printed red, as the Show knob prints 2.5D+: a setting that runs hot. */
  hot?: boolean;
  /**
   * Shown in place of the words, which stay on as the tooltip and for screen
   * readers: a 16px icon file, or a path on a 12px pixel grid in the menu's ink.
   */
  image?: string;
  glyph?: string;
  /** A legend's color, in a small square ahead of the words. */
  swatch?: string;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  /** A toggle or a scrub leaves the menu open, so it can be picked again. */
  keepOpen?: boolean;
  onSelect?: () => void;
  ring?: Ring;
};

export type Ring = {
  items: RingNode[];
  /** Degrees each item takes up around the ring, on average when `weights` share them out unevenly. */
  step: number;
  /** How much of the ring each item gets relative to the others, for words of very different lengths. */
  weights?: number[];
  /** Where the first item starts, degrees clockwise from 3 o'clock; centered on its parent when left out. */
  start?: number;
};

const C = {
  wood: "#e3c79a",
  woodDark: "#cfae7c",
  pressed: "#c29c64",
  latewood: "#8a5a2b",
  bark: "#5a3a1c",
  crack: "#3b2412",
  pith: "#b0804a",
  text: "#2b1a0b",
  light: "#ffffff",
  shadow: "#404040",
  grayed: "#808080",
  accent: "#000080",
  hot: "#b01e10",
};

/** Radii: the pith, the cross-section and its bark, then the two growth rings outside it. */
const PITH = 12;
const DISK = 50;
const BARK = 4;
const RINGS: [number, number][] = [
  [DISK + BARK + 4, DISK + BARK + 40],
  [DISK + BARK + 44, DISK + BARK + 74],
];
/** The whole menu's reach from its center, bevel included. */
const REACH = RINGS[1][1] + 2;
/** A legend swatch and the gap after it, and roughly how wide a character of the 11px menu font runs, pixels. */
const SWATCH = 9;
const SWATCH_GAP = 4;
export const CHAR_WIDTH = 5.5;

const rad = (a: number) => (a * Math.PI) / 180;
const polar = (r: number, a: number) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))] as const;
const f = (n: number) => n.toFixed(2);

/** An annulus between r0 and r1 from a0 to a1 degrees, clockwise from 3 o'clock. */
function sector(r0: number, r1: number, a0: number, a1: number) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/**
 * The arc a ring label runs along: left to right over the top, and flipped
 * along the bottom so it never reads upside down. `down` moves the line that
 * many pixels down the page as it reads, for a second line under the first.
 * `at` finds the point a distance along it, for a swatch ahead of the words.
 */
function labelArc(mid: number, a0: number, a1: number, down = 0) {
  const m = (((a0 + a1) / 2) % 360 + 360) % 360;
  const bottom = m > 5 && m < 175;
  const r = bottom ? mid + 4 + down : mid - 4 - down;
  const [sa, ea, sweep] = bottom ? [a1, a0, 0] : [a0, a1, 1];
  const [x0, y0] = polar(r, sa);
  const [x1, y1] = polar(r, ea);
  return {
    d: `M${f(x0)} ${f(y0)}A${r} ${r} 0 0 ${sweep} ${f(x1)} ${f(y1)}`,
    length: r * rad(a1 - a0),
    at: (along: number, radius = mid) => polar(radius, sa + ((bottom ? -1 : 1) * along * 180) / (Math.PI * r)),
  };
}

/** Where each item on a ring starts and ends. */
function spans(ring: Ring, from: number): [number, number][] {
  const total = ring.step * ring.items.length;
  const w = ring.weights ?? ring.items.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  let a = from;
  return ring.items.map((_, k) => {
    const a0 = a;
    a += (total * w[k]) / sum;
    return [a0, a];
  });
}

/** A wedge-shaped arrow from r0 out to r1 at angle a: there's another ring that way. */
function arrow(r0: number, r1: number, a: number, spread: number) {
  const [ax, ay] = polar(r1, a);
  const [bx, by] = polar(r0, a - spread);
  const [qx, qy] = polar(r0, a + spread);
  return `M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}L${f(qx)} ${f(qy)}Z`;
}

/** A shape with the Windows bevel round it: lit from the top left, or pressed in. */
function Bevel({ d, fill, pressed }: { d: string; fill: string; pressed?: boolean }) {
  return (
    <>
      <path d={d} fill={pressed ? C.light : C.shadow} transform="translate(1,1)" />
      <path d={d} fill={pressed ? C.shadow : C.light} transform="translate(-1,-1)" />
      <path d={d} fill={fill} />
    </>
  );
}

/** Which ring (0 is the cross-section itself) and which item on it. */
type Focus = { level: number; i: number } | null;

/**
 * trees.exe's right-click menu: a cut through a trunk, opened round the
 * point clicked. The cross-section's wedges each grow a ring of choices
 * around the outside when pointed at, and a choice on that ring can grow a
 * second ring outside it again — a compass for Rotate, a clock face for Sun.
 * It sits at the top of the page, nudged in from the screen's edges, and a
 * pick, a press anywhere else, another right-click, Escape, or the page
 * losing focus closes it. Arrow keys walk a ring, Enter steps out onto the
 * next one, Escape steps back in.
 */
export default function TreesRingMenu({
  x,
  y,
  wedges,
  start,
  onDismiss,
}: {
  x: number;
  y: number;
  wedges: RingNode[];
  /** Where the first wedge starts, degrees clockwise from 3 o'clock; centered at the top when left out. */
  start?: number;
  onDismiss: () => void;
}) {
  const uid = useId().replace(/:/g, "");
  // The way out from the middle: which wedge's ring is showing, then which of that ring's items has its own ring showing.
  const [open, setOpen] = useState<number[]>([]);
  const [focus, setFocus] = useState<Focus>(null);

  const margin = 4;
  const cx = Math.max(REACH + margin, Math.min(x, window.innerWidth - REACH - margin));
  const cy = Math.max(REACH + margin, Math.min(y, window.innerHeight - REACH - margin));

  const step = 360 / wedges.length;
  const disk: Ring = { items: wedges, step, start: start ?? -90 - step / 2 };

  // Each ring out along the open path, with where it starts and the angle at the middle of each item.
  type Laid = { ring: Ring; from: number };
  const laid: Laid[] = [{ ring: disk, from: disk.start! }];
  for (let level = 0; level < open.length; level++) {
    const { ring, from } = laid[level];
    const node = ring.items[open[level]];
    if (!node?.ring || node.disabled) break;
    const [c0, c1] = spans(ring, from)[open[level]];
    const center = (c0 + c1) / 2;
    laid.push({ ring: node.ring, from: node.ring.start ?? center - (node.ring.items.length * node.ring.step) / 2 });
  }
  const itemsAt = (level: number) => laid[level]?.ring.items ?? [];

  const opens = (node: RingNode | undefined) => !!node?.ring && !node.disabled;

  const point = (level: number, i: number) => {
    setFocus({ level, i });
    setOpen((o) => [...o.slice(0, level), ...(opens(itemsAt(level)[i]) && level < RINGS.length ? [i] : [])]);
  };

  const pick = (level: number, i: number) => {
    const node = itemsAt(level)[i];
    if (!node || node.disabled) return;
    if (node.ring && level < RINGS.length) {
      setOpen((o) => [...o.slice(0, level), i]);
      const now = node.ring.items.findIndex((it) => it.on && !it.disabled);
      setFocus({ level: level + 1, i: Math.max(0, now) });
      return;
    }
    if (!node.keepOpen) onDismiss();
    node.onSelect?.();
  };

  // The keys act on whatever's open and pointed at now; the listeners read it
  // from here rather than being put up afresh on every render. Taken down and
  // put back up, they can miss a press outright: the map re-renders on the way
  // down to the canvas, between the window's capture and the document's.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onDismissRef = useRef(onDismiss);
  const svgRef = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
    onKeyRef.current = (e) => {
      const keys = ["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "];
      if (!keys.includes(e.key)) return;
      // The trees window takes Escape and Space for itself while it's focused; the menu has them first.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        if (focus && focus.level > 0) {
          setFocus({ level: focus.level - 1, i: open[focus.level - 1] });
          setOpen((o) => o.slice(0, focus.level));
        } else onDismiss();
        return;
      }
      const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
      if (!focus) {
        if (dir) point(0, dir > 0 ? 0 : wedges.length - 1);
        return;
      }
      const n = itemsAt(focus.level).length;
      if (dir) point(focus.level, (focus.i + dir + n) % n);
      else pick(focus.level, focus.i);
    };
  });

  useEffect(() => {
    const dismiss = () => onDismissRef.current();
    const onDown = (e: PointerEvent) => {
      // A right-click anywhere closes it, and the menu it would open is swallowed.
      if (e.button === 2) {
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        window.addEventListener("contextmenu", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("contextmenu", swallow, { capture: true }), 1000);
        dismiss();
      } else if (!(e.target instanceof Node) || !svgRef.current?.contains(e.target)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  const size = REACH * 2 + 2;
  const live: React.CSSProperties = { pointerEvents: "auto", cursor: "default" };
  const isLit = (level: number, i: number, node: RingNode) =>
    !node.disabled && ((focus?.level === level && focus.i === i) || open[level] === i);
  const ink = (lit: boolean, node: RingNode) => (lit ? C.light : node.disabled ? C.grayed : node.hot ? C.hot : C.text);
  const itemProps = (level: number, i: number, node: RingNode) => {
    const role = node.role ?? "menuitem";
    return {
      role,
      "aria-checked": role === "menuitem" ? undefined : !!node.on,
      "aria-haspopup": node.ring ? ("menu" as const) : undefined,
      "aria-expanded": node.ring ? open[level] === i : undefined,
      "aria-disabled": node.disabled || undefined,
      "aria-label": [node.title ?? node.label, node.value].filter(Boolean).join(": "),
      style: live,
      onPointerEnter: () => point(level, i),
      onClick: () => pick(level, i),
    };
  };

  /** One of the growth rings: a bevelled piece of wood per item, its words along the arc or its icon upright in the middle. */
  const growthRing = (level: number) => {
    const { ring, from } = laid[level];
    const [r0, r1] = RINGS[level - 1];
    const mid = (r0 + r1) / 2;
    return (
      <g key={level}>
        {spans(ring, from).map(([a0, a1], k) => {
          const node = ring.items[k];
          const d = sector(r0, r1, a0, a1);
          const lit = isLit(level, k, node);
          const id = `${uid}-${level}-${k}`;
          const color = ink(lit, node);
          const [ix, iy] = polar(mid, (a0 + a1) / 2);
          return (
            <g key={k} {...itemProps(level, k, node)}>
              {(node.title || node.image || node.glyph) && <title>{node.title ?? node.label}</title>}
              <Bevel d={d} fill={lit ? C.accent : node.on ? C.pressed : k % 2 ? C.woodDark : C.wood} pressed={node.on} />
              <path d={d} fill="none" stroke={C.latewood} strokeWidth={0.75} />
              {node.ring && !node.disabled && level < RINGS.length && (
                <path d={arrow(r1 + 0.5, r1 + 4, (a0 + a1) / 2, (4 / r1) * (180 / Math.PI))} fill={lit ? C.accent : C.bark} />
              )}
              <g style={{ pointerEvents: "none" }}>
                {node.image ? (
                  <image
                    href={node.image}
                    x={f(ix - 8)}
                    y={f(iy - 8)}
                    width={16}
                    height={16}
                    opacity={node.disabled ? 0.4 : 1}
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : node.glyph ? (
                  <path d={node.glyph} transform={`translate(${Math.round(ix - 6)},${Math.round(iy - 6)})`} fill={color} shapeRendering="crispEdges" />
                ) : (
                  <>
                    {(() => {
                      const arc = labelArc(mid, a0, a1, node.value ? -6 : 0);
                      // With a swatch, the pair is centered: the words move along by half the swatch's room, the swatch sits ahead of them.
                      const lead = node.swatch ? (SWATCH + SWATCH_GAP) / 2 : 0;
                      const [sx, sy] = arc.at(arc.length / 2 - (SWATCH + SWATCH_GAP + node.label.length * CHAR_WIDTH) / 2 + SWATCH / 2);
                      return (
                        <>
                          <path id={`${id}-a`} d={arc.d} fill="none" />
                          {node.swatch && (
                            <rect
                              x={Math.round(sx - SWATCH / 2) + 0.5}
                              y={Math.round(sy - SWATCH / 2) + 0.5}
                              width={SWATCH - 1}
                              height={SWATCH - 1}
                              fill={node.swatch}
                              stroke="#000"
                              opacity={node.disabled ? 0.4 : 1}
                            />
                          )}
                          <text fill={color}>
                            <textPath href={`#${id}-a`} startOffset={arc.length / 2 + lead} textAnchor="middle">
                              {node.label}
                            </textPath>
                          </text>
                        </>
                      );
                    })()}
                    {node.value && (
                      <>
                        <path id={`${id}-b`} d={labelArc(mid, a0, a1, 6).d} fill="none" />
                        <text fill={color} opacity={lit ? 1 : 0.8}>
                          <textPath href={`#${id}-b`} startOffset="50%" textAnchor="middle">
                            {node.value}
                          </textPath>
                        </text>
                      </>
                    )}
                  </>
                )}
              </g>
            </g>
          );
        })}
      </g>
    );
  };

  return createPortal(
    <svg
      ref={svgRef}
      role="menu"
      aria-label="trees.exe"
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: cx - size / 2,
        top: cy - size / 2,
        zIndex: Z.START_MENU,
        // Only the wood takes the pointer: a press in the square's empty corners goes on to the map, and closes the menu.
        pointerEvents: "none",
        overflow: "visible",
        fontSize: 11,
        userSelect: "none",
      }}
    >
      {/* The growth rings out along the open path, the outer one first so the inner one's arrows sit over it. */}
      {laid
        .map((_, level) => level)
        .slice(1)
        .reverse()
        .map(growthRing)}

      {/* The cross-section: bark round the edge, a wedge each, the rings drawn across them. */}
      <circle r={DISK + BARK} fill={C.shadow} transform="translate(1,1)" style={live} />
      <circle r={DISK + BARK} fill={C.light} transform="translate(-1,-1)" />
      <circle r={DISK + BARK} fill={C.bark} />
      {wedges.map((w, i) => {
        const a0 = disk.start! + i * step;
        return (
          <g key={i} {...itemProps(0, i, w)}>
            {w.title && <title>{w.title}</title>}
            <path d={sector(PITH, DISK, a0, a0 + step)} fill={isLit(0, i, w) ? C.accent : C.wood} stroke={C.crack} strokeWidth={1.5} />
          </g>
        );
      })}
      <g style={{ pointerEvents: "none" }}>
        {[22, 32, 42].map((r) => (
          <circle key={r} r={r} fill="none" stroke={C.latewood} strokeWidth={0.8} opacity={0.45} />
        ))}
        {wedges.map((w, i) => {
          const mid = disk.start! + (i + 0.5) * step;
          const [tx, ty] = polar(PITH + (DISK - PITH) / 2, mid);
          const lit = isLit(0, i, w);
          const color = ink(lit, w);
          const dy = w.value ? -2 : 4;
          return (
            <g key={i} textAnchor="middle">
              {/* Grayed out the Windows way: embossed, with a white shadow. */}
              {w.disabled && (
                <text x={tx + 1} y={ty + dy + 1} fill={C.light} fontWeight="bold">
                  {w.label}
                </text>
              )}
              <text x={tx} y={ty + dy} fill={color} fontWeight="bold">
                {w.label}
              </text>
              {w.value && (
                <text x={tx} y={ty + dy + 12} fill={color}>
                  {w.value}
                </text>
              )}
              {/* A notch in the bark, pointing out to where the wedge's ring will grow. */}
              {w.ring && !w.disabled && <path d={arrow(DISK - 1, DISK + BARK + 1, mid, 4)} fill={lit ? C.accent : C.wood} />}
            </g>
          );
        })}
        <circle r={PITH} fill={C.pith} stroke={C.crack} strokeWidth={1.5} />
        <circle r={PITH - 5} fill="none" stroke={C.latewood} strokeWidth={0.8} />
      </g>
    </svg>,
    document.body,
  );
}
