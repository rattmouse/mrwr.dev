"use client";

import React, { useEffect, useRef, useState } from "react";
import { portraitSprite } from "@/components/windows/DndPortrait";
import type { Character } from "@/lib/dnd";
import { emojiSprite } from "@/lib/emojiSprite";
import { GuySheet, guyBounds, loadGuys, tintGuys } from "@/lib/guys";

/** One figure to stand in the preview, already toned for the surface behind it. */
export type PreviewFigure = {
  /** A painted guy, a dot, or an emoji sprite. */
  kind: "guy" | "dot" | "emoji";
  emoji?: string;
  tone: string;
  /** Which painted figure, for a guy. */
  pose: number;
  flip: boolean;
  /** Their own size roll, where 1 is ordinary. */
  size: number;
};

const HEIGHT = 76;
// How tall a figure stands here: one picked is shown big, a group smaller so
// a handful fit across the panel.
const ONE_HEIGHT = 54;
const GROUP_HEIGHT = 32;

/**
 * The Palette's picture of what it is dressing: the one node picked, drawn
 * large exactly as the canvas has them, or — with nothing picked — a little
 * group in the crowd's own look. It is drawn once per change rather than
 * animated; it is a swatch, not a second canvas.
 */
export default function PartyNodePreview({
  figures,
  member,
  surface,
  children,
}: {
  figures: PreviewFigure[];
  /** A party member picked: their loadout tile, in `figures[0]`'s tone. */
  member?: Pick<Character, "race" | "cls" | "alignment"> | null;
  surface: string;
  /** Buttons laid over the swatch's top-right corner. */
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sheet, setSheet] = useState<GuySheet | null>(null);
  const wantsGuys = figures.some((f) => f.kind === "guy") || !!member;

  useEffect(() => {
    if (!wantsGuys) return;
    let cancelled = false;
    void loadGuys().then((loaded) => {
      if (!cancelled) setSheet(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsGuys]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, canvas.clientWidth);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const one = figures.length === 1;
    const base = one ? ONE_HEIGHT : GROUP_HEIGHT;
    const slot = width / Math.max(1, figures.length);
    const mid = HEIGHT / 2;

    figures.forEach((figure, i) => {
      const x = slot * i + slot / 2;
      const h = base * figure.size;

      if (member && one) {
        const sprite = portraitSprite(member, figure.tone, sheet);
        if (!sprite) return;
        const w = h * (sprite.width / sprite.height);
        ctx.save();
        // The tile is a handful of actual pixels; smoothing turns it to mush.
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, x - w / 2, mid - h / 2, w, h);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.translate(x, mid);
      if (figure.flip) ctx.scale(-1, 1);
      if (figure.kind === "emoji" && figure.emoji) {
        const sprite = emojiSprite(figure.emoji);
        if (sprite) ctx.drawImage(sprite, -h / 2, -h / 2, h, h);
      } else if (figure.kind === "guy" && sheet) {
        // Cut to the figure's own ink rather than its cell, so a short guy
        // stands as big in the swatch as a tall one and isn't lost in blank.
        const ink = guyBounds(figure.pose);
        const w = h * (ink.w / ink.h);
        ctx.drawImage(tintGuys(sheet, figure.tone), ink.x, ink.y, ink.w, ink.h, -w / 2, -h / 2, w, h);
      } else {
        // A dot on the canvas is a couple of pixels; here it is a swatch.
        ctx.fillStyle = figure.tone;
        ctx.beginPath();
        ctx.arc(0, 0, one ? 9 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }, [figures, member, sheet]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          display: "block",
          width: "100%",
          height: HEIGHT,
          borderRadius: 9,
          background: surface,
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      />
      {React.Children.toArray(children).length > 0 && (
        <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}>{children}</div>
      )}
    </div>
  );
}
