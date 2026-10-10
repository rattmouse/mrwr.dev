"use client";

import React from "react";
import type { Command } from "@/lib/facade";

const INK = "#000";
const NAVY = "#000080";
const GREEN = "#008000";
const RED = "#c00000";
const TEAL = "#008080";
const GREY = "#808080";

const Tri = ({ pts, fill = NAVY }: { pts: string; fill?: string }) => <polygon points={pts} fill={fill} />;
const Bar = ({ x, y = 4, w = 2, h = 8, fill = NAVY }: { x: number; y?: number; w?: number; h?: number; fill?: string }) => (
  <rect x={x} y={y} width={w} height={h} fill={fill} />
);

/** A funnel, for anything that changes what the threshold lets through. */
const Funnel = ({ fill = TEAL }: { fill?: string }) => <path d="M1 2H13L8.5 8V14L5.5 12.5V8Z" fill={fill} stroke={INK} strokeWidth={1} strokeLinejoin="round" />;
const Plus = ({ fill }: { fill: string }) => (
  <>
    <rect x={12} y={9} width={2} height={6} fill={fill} />
    <rect x={10} y={11} width={6} height={2} fill={fill} />
  </>
);
const Minus = ({ fill }: { fill: string }) => <rect x={10} y={11} width={6} height={2} fill={fill} />;
const Cross = () => <path d="M10 9L15 14M15 9L10 14" stroke={RED} strokeWidth={2} />;

const Flag = ({ fill = RED }: { fill?: string }) => (
  <>
    <rect x={3} y={1} width={1.5} height={14} fill={INK} />
    <polygon points="4.5,2 13,4.5 4.5,8" fill={fill} stroke={INK} strokeWidth={0.5} />
  </>
);

/** Little bar charts, one bar picked out: the tallest for "densest", the shortest for "emptiest". */
const Bars = ({ heights, lit }: { heights: number[]; lit: number }) => (
  <>
    <rect x={0.5} y={15} width={15} height={0.75} fill={INK} />
    {heights.map((h, i) => (
      <rect key={i} x={1.5 + i * 3.5} y={15 - h} width={2.5} height={h} fill={i === lit ? RED : NAVY} />
    ))}
  </>
);

/** A list with a down arrow beside it: sorting. */
const Sorted = ({ children }: { children: React.ReactNode }) => (
  <>
    <rect x={2.5} y={2} width={2} height={8} fill={INK} />
    <Tri pts="0.5,9 6.5,9 3.5,14" fill={INK} />
    {children}
  </>
);

function draw(c: Command): React.ReactNode {
  switch (c.do) {
    case "step":
      if (c.by === 1) return <path d="M2 7H9V3.5L14 8L9 12.5V9H2Z" fill={NAVY} />;
      if (c.by === -1) return <path d="M14 7H7V3.5L2 8L7 12.5V9H14Z" fill={NAVY} />;
      if (c.by > 0)
        return (
          <>
            <Tri pts="2,3 8,8 2,13" />
            <Tri pts="8,3 14,8 8,13" />
          </>
        );
      return (
        <>
          <Tri pts="14,3 8,8 14,13" />
          <Tri pts="8,3 2,8 8,13" />
        </>
      );
    case "seek":
      if (c.to === "start")
        return (
          <>
            <Bar x={2} y={3} h={10} />
            <Tri pts="13,3 5,8 13,13" />
          </>
        );
      if (c.to === "end")
        return (
          <>
            <Tri pts="3,3 11,8 3,13" />
            <Bar x={12} y={3} h={10} />
          </>
        );
      if (c.to === "middle")
        return (
          <>
            <Tri pts="0.5,4 6,8 0.5,12" />
            <Bar x={7} y={2} h={12} fill={RED} />
            <Tri pts="15.5,4 10,8 15.5,12" />
          </>
        );
      if (c.to === "densest") return <Bars heights={[5, 8, 13, 6]} lit={2} />;
      return <Bars heights={[9, 11, 2, 8]} lit={2} />;
    case "back":
      return (
        <>
          <path d="M6 5H10.5A3.5 3.5 0 0 1 10.5 12H7" fill="none" stroke={NAVY} strokeWidth={2.2} />
          <Tri pts="7,1 1.5,5 7,9" />
        </>
      );
    case "order":
      if (c.order === 0)
        return (
          <Sorted>
            <rect x={8} y={2} width={7} height={2} fill={NAVY} />
            <rect x={8} y={6.5} width={7} height={2} fill={NAVY} />
            <rect x={8} y={11} width={7} height={2} fill={NAVY} />
          </Sorted>
        );
      if (c.order === 1)
        return (
          <Sorted>
            <rect x={8} y={2} width={7.5} height={2.5} fill={NAVY} />
            <rect x={8} y={6.5} width={5} height={2.5} fill={NAVY} />
            <rect x={8} y={11} width={2.5} height={2.5} fill={NAVY} />
          </Sorted>
        );
      // A over Z.
      return (
        <Sorted>
          <path d="M8 7.5L10.5 1.5L13 7.5M9 5.5H12" fill="none" stroke={NAVY} strokeWidth={1.3} />
          <path d="M8 9.5H13L8 14.5H13" fill="none" stroke={NAVY} strokeWidth={1.3} />
        </Sorted>
      );
    case "threshold":
      if (c.to === 0)
        return (
          <>
            <Funnel />
            <Cross />
          </>
        );
      if (c.to !== undefined) return <Funnel fill={RED} />;
      return (
        <>
          <Funnel />
          {(c.by ?? 0) > 0 ? <Plus fill={GREEN} /> : <Minus fill={RED} />}
        </>
      );
    case "tabs":
      return (
        <>
          <rect x={4.5} y={1.5} width={10} height={8} fill="#fff" stroke={GREY} />
          <rect x={5} y={2} width={9} height={2} fill={GREY} />
          <rect x={1.5} y={6.5} width={10} height={8} fill="#fff" stroke={INK} />
          <rect x={2} y={7} width={9} height={2} fill={NAVY} />
        </>
      );
    case "follow":
      return <Tri pts="4,2 13,8 4,14" fill={GREEN} />;
    case "pick":
      // An eyedropper.
      return (
        <>
          <path d="M2.5 13.5L9.5 6.5" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={11.5} cy={4.5} r={3} fill={INK} />
          <rect x={1} y={14} width={2} height={2} fill={NAVY} />
        </>
      );
    case "findNext":
      return (
        <>
          <path d="M9.5 9.5L14.5 14.5" stroke="#804000" strokeWidth={3} strokeLinecap="round" />
          <circle cx={6} cy={6} r={4.2} fill="#c8e4ff" stroke={INK} strokeWidth={1.6} />
        </>
      );
    case "clear":
      // An eraser.
      return (
        <>
          <polygon points="1,10.5 7.5,4 13,9.5 6.5,16" fill="#ff8c8c" stroke={INK} strokeWidth={0.8} />
          <polygon points="7.5,4 10.5,1 16,6.5 13,9.5" fill="#fff" stroke={INK} strokeWidth={0.8} />
        </>
      );
    case "markSimilar":
      // A magic wand.
      return (
        <>
          <path d="M2 14L10 6" stroke={INK} strokeWidth={2} strokeLinecap="round" />
          <path d="M12 1V5M10 3H14M14.5 7V10M13 8.5H16M7 0.5V3M5.5 1.75H8.5" stroke="#c0a000" strokeWidth={1.2} />
        </>
      );
    case "rescan":
      return (
        <>
          <path d="M13 8A5 5 0 1 1 10.5 3.6" fill="none" stroke={GREEN} strokeWidth={2.2} />
          <Tri pts="8,0.5 14,2.5 10,7" fill={GREEN} />
        </>
      );
    case "verify":
      return <path d="M2 8.5L6 12.5L14 3.5" fill="none" stroke={GREEN} strokeWidth={2.8} strokeLinejoin="round" />;
    case "mark":
      return <Flag />;
    case "nextMark":
      return (
        <>
          <Flag />
          <Tri pts="9,10 15,12.5 9,15" />
        </>
      );
    case "unmark":
      return (
        <>
          <Flag fill={GREY} />
          <Cross />
        </>
      );
    case "report":
      return (
        <>
          <path d="M3 1H10L13 4V15H3Z" fill="#fff" stroke={INK} strokeWidth={1} />
          <path d="M10 1V4H13" fill="none" stroke={INK} strokeWidth={1} />
          {[6, 8, 10, 12].map((y) => (
            <rect key={y} x={5} y={y} width={y === 12 ? 4 : 6} height={1} fill={GREY} />
          ))}
        </>
      );
  }
}

/** The toolbar picture for a command, in the plain 16px style toolbars used to have. */
export default function CommandIcon({ command }: { command: Command }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ display: "block" }}>
      {draw(command)}
    </svg>
  );
}
