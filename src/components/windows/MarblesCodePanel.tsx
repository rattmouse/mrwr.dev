"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, TextInput, Window, WindowContent, WindowHeader } from "react95";
import { copyText } from "@/lib/marblesShare";

/**
 * The code window: marbles.exe's password screen.
 *
 * What is in the box when it opens is the code for the course you are on —
 * with your best time and the whole of your best run in it, if you have got
 * round. Copy it and send it to somebody however you like. Paste somebody
 * else's in its place and press Go, and you are on their course with their
 * time to beat and their run riding round beside you.
 */

type MarblesCodePanelProps = {
  /** Your code for this course, already written out in groups. */
  code: string;
  /** Whether that code carries a run, or only the course. */
  carries: "course" | "run";
  /** Take a pasted code. False if it was nothing anybody could make sense of. */
  onUse: (text: string) => boolean;
  onClose: () => void;
};

export default function MarblesCodePanel({ code, carries, onUse, onClose }: MarblesCodePanelProps) {
  const [text, setText] = useState(code);
  const [said, setSaid] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // Open with the whole thing picked out, so that the first thing the keyboard
  // can do is copy it.
  useEffect(() => {
    boxRef.current?.focus();
    boxRef.current?.select();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const say = (words: string) => {
    setSaid(words);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSaid(null), 1800);
  };

  const copy = async () => {
    boxRef.current?.select();
    say((await copyText(text)) ? "Copied!" : "Copy it by hand — this browser said no");
  };

  const use = () => {
    if (text.trim() === code.trim()) {
      say("That is the code you are already on");
      return;
    }
    if (onUse(text)) onClose();
    else say("That is not a code");
  };

  return (
    <Window style={{ width: "min(420px, 92%)", pointerEvents: "auto" }}>
      <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Course code</span>
        <Button size="sm" square onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </WindowHeader>
      <WindowContent>
        <div style={{ fontSize: 11, marginBottom: 6, lineHeight: 1.35 }}>
          {carries === "run"
            ? "This course, your time on it and the run itself. Send it to somebody and they can race you."
            : "This course. Get round it once and your time and your run go in the code too."}
        </div>
        <TextInput
          ref={boxRef}
          multiline
          rows={4}
          value={text}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
          spellCheck={false}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11 }}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <Button onClick={copy}>Copy</Button>
          <Button onClick={use}>Go</Button>
          <Button onClick={onClose}>Close</Button>
          {said && <span style={{ fontSize: 11, opacity: 0.8 }}>{said}</span>}
        </div>
      </WindowContent>
    </Window>
  );
}
