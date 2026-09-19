"use client";

import React, { useEffect, useState } from "react";
import { loadMeltNoise } from "@/lib/meltNoise";

/**
 * The filter that pulls a window out of true — interface.exe's Frame panel
 * points the window's `filter` at it and dials `amount` up.
 *
 * It lives outside the frame it distorts, because a filter cannot be defined
 * inside the subtree it is applied to. The region is a little larger than the
 * window so the displaced edges are not clipped off, and no larger than that:
 * everything inside a filter's region is re-rasterised whenever anything in the
 * filtered element repaints, and this one contains an animating canvas.
 */
export function MeltFilter({ id, amount }: { id: string; amount: number }) {
  // Soft at first — a frame that has only just gone warm should waver, not
  // dissolve.
  const scale = Math.round(amount * amount * 26 + amount * 5);
  // The displacement map is a pre-built tile rather than live turbulence: the
  // filter re-runs on every repaint inside the window, and there is no sense
  // generating the same noise sixty times a second. Until the tile is ready (a
  // frame or two), turbulence stands in.
  const [noise, setNoise] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadMeltNoise().then((url) => {
      if (!cancelled && url) setNoise(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          {noise ? (
            <>
              <feImage href={noise} x="0" y="0" width="256" height="256" result="tile" />
              <feTile in="tile" result="noise" />
            </>
          ) : (
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.009 0.016"
              numOctaves={2}
              seed={7}
              result="noise"
            />
          )}
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

export default MeltFilter;
