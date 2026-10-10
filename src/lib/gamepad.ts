import { useEffect, useRef } from "react";

/**
 * Game controllers, through the browser's Gamepad API. Nothing there arrives
 * as an event — a pad has to be read every frame — so a window that wants one
 * calls `useGamepad`, which reads it on its own animation frame for as long as
 * a pad is plugged in and hands over a `Pad`: the sticks with their dead zone
 * taken out, and which buttons are held or have just gone down.
 *
 * Buttons go by where they sit in the standard mapping, named the Xbox way: A
 * is the bottom face button whatever is printed on it. Every pad plugged in is
 * read as one, so whichever is picked up works.
 *
 * Only a page that has the focus hears it, the way only it hears the keyboard.
 * That includes a page whose focus is down in a frame inside it — the computer
 * on the desk in cubicles.exe — so the frame and the page around it both hear
 * the pad then, and the page should keep to what can't clash.
 *
 * Back belongs to the desktop's shell — the Start menu and taskbar, see
 * StartMenu — wherever one is mounted and the focus isn't down in a frame:
 * windows never see it there. And while the shell has the pad, they see
 * nothing at all.
 */

const BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;
export type PadButton = keyof typeof BUTTONS;

export type PadDirection = "up" | "down" | "left" | "right";

/** -1 … 1 each way, y down-positive the way pads report it. */
export type Stick = { x: number; y: number };

export type Pad = {
  /** The left stick, with the d-pad added in. */
  move: Stick;
  /** The right stick. */
  look: Stick;
  /** How far each trigger is pulled, 0 … 1. */
  lt: number;
  rt: number;
  held(button: PadButton): boolean;
  /** Down this frame and not the last. */
  pressed(button: PadButton): boolean;
  /** Pressed, and again every so often for as long as it is held. */
  repeat(button: PadButton): boolean;
  /** The d-pad, or the left stick pushed most of the way, pressed or held — for stepping through a menu. */
  nav: PadDirection | null;
};

/** Sticks rest a little off centre; under this much push counts as none. */
const DEAD_ZONE = 0.2;
/** How far over the left stick has to go to count as a menu step. */
const NAV_PUSH = 0.6;
/** A held button's first repeat, and every one after it, in ms. */
const REPEAT_AFTER = 380;
const REPEAT_EVERY = 110;

const NAV: PadDirection[] = ["up", "down", "left", "right"];

const STILL: Stick = { x: 0, y: 0 };

/** How many shells are mounted on this page; only the top page's mounts one. */
let shells = 0;
/** Whether a shell is being worked from the pad right now. */
let shellHolds = false;

/** The shell taking the pad from the windows, or giving it back. */
export function holdPad(on: boolean) {
  shellHolds = on;
}

/** Whether the shell is the one to hear Back: there is one, and the pad isn't a frame's. */
function shellHere(): boolean {
  return shells > 0 && !(document.activeElement instanceof HTMLIFrameElement);
}

/** Nothing pushed and nothing pressed: what a window is told when it stops hearing the pad. */
export const IDLE: Pad = {
  move: STILL,
  look: STILL,
  lt: 0,
  rt: 0,
  held: () => false,
  pressed: () => false,
  repeat: () => false,
  nav: null,
};

/** Takes the dead zone out and stretches what's left back over 0 … 1. */
function deadZone(x: number, y: number): Stick {
  const m = Math.hypot(x, y);
  if (m < DEAD_ZONE) return STILL;
  const k = Math.min(1, (m - DEAD_ZONE) / (1 - DEAD_ZONE)) / m;
  return { x: x * k, y: y * k };
}

function clampUnit(s: Stick): Stick {
  const m = Math.hypot(s.x, s.y);
  return m > 1 ? { x: s.x / m, y: s.y / m } : s;
}

function padsPlugged(): Gamepad[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p && p.connected);
}

/**
 * One window's view of the pad. Each keeps its own idea of what was held last
 * frame, so two windows reading the same press both see it as a press.
 */
function makeReader(shell: boolean) {
  /** What was held last frame; null after a spell of not hearing the pad. */
  let before: Set<string> | null = null;
  /** When each held button next repeats. */
  const due = new Map<string, number>();

  /** Null once there are no pads at all. */
  return (now: number): Pad | null => {
    const pads = padsPlugged();
    if (!pads.length) {
      before = null;
      return null;
    }
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      before = null;
      return IDLE;
    }
    const here = shellHere();
    if (shell ? !here : here && shellHolds) {
      before = null;
      return IDLE;
    }

    const held = new Set<string>();
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    let lt = 0;
    let rt = 0;
    for (const pad of pads) {
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) held.add(String(i));
      });
      if (!shell && here) held.delete(String(BUTTONS.Back));
      lt = Math.max(lt, pad.buttons[BUTTONS.LT]?.value ?? 0);
      rt = Math.max(rt, pad.buttons[BUTTONS.RT]?.value ?? 0);
      lx += pad.axes[0] ?? 0;
      ly += pad.axes[1] ?? 0;
      rx += pad.axes[2] ?? 0;
      ry += pad.axes[3] ?? 0;
    }
    const left = deadZone(lx, ly);
    const has = (b: PadButton) => held.has(String(BUTTONS[b]));
    const dx = (has("Right") ? 1 : 0) - (has("Left") ? 1 : 0);
    const dy = (has("Down") ? 1 : 0) - (has("Up") ? 1 : 0);
    const move = clampUnit({ x: left.x + dx, y: left.y + dy });

    // The menu steps, as buttons of their own so they repeat like the rest.
    if (has("Up") || ly < -NAV_PUSH) held.add("up");
    if (has("Down") || ly > NAV_PUSH) held.add("down");
    if (has("Left") || lx < -NAV_PUSH) held.add("left");
    if (has("Right") || lx > NAV_PUSH) held.add("right");

    // Back from not hearing it, whatever is already held down counts as held,
    // not pressed — the press that focused this window is not one for it.
    const was = before ?? held;
    const went = new Set<string>();
    const again = new Set<string>();
    for (const key of held) {
      if (!was.has(key)) {
        went.add(key);
        again.add(key);
        due.set(key, now + REPEAT_AFTER);
      } else if (now >= (due.get(key) ?? Infinity)) {
        again.add(key);
        due.set(key, now + REPEAT_EVERY);
      }
    }
    for (const key of due.keys()) if (!held.has(key)) due.delete(key);
    before = held;

    return {
      move,
      look: deadZone(rx, ry),
      lt,
      rt,
      held: has,
      pressed: (b) => went.has(String(BUTTONS[b])),
      repeat: (b) => again.has(String(BUTTONS[b])),
      nav: NAV.find((d) => again.has(d)) ?? null,
    };
  };
}

/**
 * Reads the pad every frame while `enabled` and a pad is plugged in, and
 * hands it to `onPad` with the frame's length in seconds. Losing the focus,
 * being switched off or unmounting all end with one last IDLE, so nothing the
 * pad was holding stays held.
 *
 * `shell` is for the desktop's Start menu and taskbar alone: it gets Back, and
 * gets the pad while it holds it (holdPad) when the windows don't.
 */
export function useGamepad(enabled: boolean, onPad: (pad: Pad, dt: number) => void, shell = false) {
  const onPadRef = useRef(onPad);
  useEffect(() => {
    onPadRef.current = onPad;
  });

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.getGamepads) return;
    const read = makeReader(shell);
    if (shell) shells++;
    let raf = 0;
    let last = 0;
    /** Whether the window was last told anything but IDLE. */
    let live = false;

    const tick = (now: number) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const pad = read(now);
      if (pad && pad !== IDLE) {
        live = true;
        onPadRef.current(pad, dt);
      } else if (live) {
        live = false;
        onPadRef.current(IDLE, dt);
      }
      // Unplugged, it sleeps until one comes back.
      raf = pad ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    wake();
    window.addEventListener("gamepadconnected", wake);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", wake);
      if (shell) shells--;
      if (live) onPadRef.current(IDLE, 0);
    };
  }, [enabled, shell]);
}

/**
 * A row of buttons, worked from the pad: the d-pad or stick steps the focus
 * through them, A presses the focused one. With none focused yet, A focuses
 * the first — or just presses it, when it's the only one. Whether the pad did
 * anything here comes back, so the caller can leave it at that.
 */
export function padMenu(root: HTMLElement | null, pad: Pad): boolean {
  if (!root) return false;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [role=button]:not([aria-disabled=true])"),
  ).filter((el) => el.getClientRects().length > 0);
  if (!items.length) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (pad.nav) {
    const step = pad.nav === "up" || pad.nav === "left" ? -1 : 1;
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next].focus();
    return true;
  }
  if (pad.pressed("A")) {
    if (at >= 0) items[at].click();
    else if (items.length === 1) items[0].click();
    else items[0].focus();
    return true;
  }
  return false;
}
