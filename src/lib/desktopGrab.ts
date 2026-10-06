/**
 * paint.exe's Grab: a picture of any part of the page — the desktop, other
 * windows, paint.exe itself — taken while everything on it holds still.
 *
 * Freezing is done once for the whole page rather than program by program.
 * Every animation loop here runs on requestAnimationFrame, so while frozen
 * that hands out tickets instead of frames: a loop's next frame waits in a
 * queue until the thaw, and the page stops dead wherever it was. CSS
 * animations are paused alongside. Nothing is torn down, so the thaw simply
 * lets the queued frames go and everything carries on.
 *
 * The picture itself is the page's DOM drawn back onto a canvas (through an
 * SVG foreignObject, by modern-screenshot) — the browser won't hand a page a
 * screenshot of itself without a screen-share prompt.
 */
import { domToCanvas } from "modern-screenshot";

type Frozen = {
  /** The frame time the page stopped at; held frames are run with it. */
  at: number;
  style: HTMLStyleElement;
};

let frozen: Frozen | null = null;
let realRaf: typeof window.requestAnimationFrame | null = null;
let realCaf: typeof window.cancelAnimationFrame | null = null;
/** Frames asked for while frozen, by the ticket handed out for each. */
const held = new Map<number, FrameRequestCallback>();
// Well clear of the browser's own frame ids, so a cancel can tell them apart.
let nextTicket = 1_000_000_000;

const PAUSE_CSS =
  "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }";

/**
 * Stop the page moving. Safe to call again while already frozen. The
 * returned function thaws it; calling it twice is harmless.
 */
export function freezePage(): () => void {
  if (frozen) return () => {};
  if (!realRaf || !realCaf) {
    realRaf = window.requestAnimationFrame.bind(window);
    realCaf = window.cancelAnimationFrame.bind(window);
    // Cancelling has to keep knowing about tickets even after the thaw: one
    // handed out while frozen may still be waiting for its frame then.
    window.cancelAnimationFrame = (id: number) => {
      if (held.delete(id)) return;
      realCaf?.(id);
    };
  }
  const style = document.createElement("style");
  style.dataset.desktopGrab = "";
  style.textContent = PAUSE_CSS;
  document.head.appendChild(style);
  const stopped: Frozen = { at: performance.now(), style };
  frozen = stopped;
  // Frames already asked for still come, once, and their loops see that
  // frame's time; the replay mustn't hand any of them an earlier one.
  realRaf((time) => {
    stopped.at = Math.max(stopped.at, time);
  });
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const ticket = nextTicket++;
    held.set(ticket, callback);
    return ticket;
  };

  let thawed = false;
  return () => {
    if (thawed || !frozen) return;
    thawed = true;
    frozen.style.remove();
    frozen = null;
    window.requestAnimationFrame = realRaf!;
    // Everything held goes out on the next real frame, still cancellable
    // until then by the ticket its owner was given.
    realRaf!((time) => {
      const due = [...held.entries()];
      held.clear();
      for (const [, callback] of due) callback(time);
    });
  };
}

/**
 * Run every held frame once, at the moment the page stopped, so each loop
 * redraws exactly what is already showing. A WebGL canvas only keeps its
 * picture until the frame is put on screen, so this is how one is caught with
 * something in it; the loops ask for their next frame as they go, and those
 * are held as before.
 */
function replayFrame() {
  if (!frozen) return;
  const due = [...held.values()];
  held.clear();
  for (const callback of due) {
    try {
      callback(frozen.at);
    } catch (error) {
      console.warn(error);
    }
  }
}

export type GrabRect = { left: number; top: number; width: number; height: number };

const intersects = (r: DOMRect, g: GrabRect) =>
  r.right > g.left && r.bottom > g.top && r.left < g.left + g.width && r.top < g.top + g.height;

/**
 * A picture of `rect` (viewport CSS pixels) as the page looks right now, at
 * `scale` canvas pixels per CSS pixel. Anything `skip` says no to is left
 * out, along with its children.
 */
export async function grabPage(
  rect: GrabRect,
  scale: number,
  skip?: (el: Element) => boolean,
): Promise<HTMLCanvasElement> {
  // Catch every canvas's picture now, in the same task as the replayed frame,
  // and have each one hand that back when the clone asks for it later.
  replayFrame();
  const shadowed: HTMLCanvasElement[] = [];
  for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
    if (canvas.width === 0 || canvas.height === 0) continue;
    if (!intersects(canvas.getBoundingClientRect(), rect)) continue;
    try {
      const url = canvas.toDataURL();
      Object.defineProperty(canvas, "toDataURL", { configurable: true, value: () => url });
      shadowed.push(canvas);
    } catch {
      // A tainted canvas: it'll come out blank, which is all it can be.
    }
  }

  const body = document.body;
  const bodyBox = body.getBoundingClientRect();
  try {
    const page = await domToCanvas(body, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale,
      // The clone's root has its margins stripped, which leaves the body the
      // browser's default 8px and shifts the whole picture down and right.
      style: { margin: "0px" },
      backgroundColor:
        getComputedStyle(body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor,
      filter: (node) => {
        if (!(node instanceof Element)) return true;
        if (skip?.(node)) return false;
        // Pictures are the expensive part of a clone — each one is fetched
        // and inlined — so any that can't show in the grab are left behind.
        const tag = node.tagName;
        if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO" || tag === "IFRAME") {
          return intersects(node.getBoundingClientRect(), rect);
        }
        return true;
      },
    });
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.width * scale));
    out.height = Math.max(1, Math.round(rect.height * scale));
    out
      .getContext("2d")!
      .drawImage(
        page,
        Math.round((rect.left - bodyBox.left) * scale),
        Math.round((rect.top - bodyBox.top) * scale),
        out.width,
        out.height,
        0,
        0,
        out.width,
        out.height,
      );
    return out;
  } finally {
    for (const canvas of shadowed) delete (canvas as { toDataURL?: unknown }).toDataURL;
  }
}
