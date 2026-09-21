"use client";

import React, { useRef, useState } from "react";
import { Button } from "react95";
import { formatSeed } from "@/lib/marblesShare";

/**
 * What sits along the top of marbles.exe: buttons, and the seed the course was
 * rolled from — which is the course, and can be copied out, typed over or
 * pasted into. Nothing else. The clock is over the picture where it belongs
 * and the keys are in the help window, because a toolbar that also carries a
 * readout and a line of instructions stops looking like a toolbar.
 *
 * It lives out here rather than in ProgramWindow with the other toolbars
 * because the seed box is a small thing with a mind of its own: what is in it
 * is not the course until you press Enter or click away.
 */

/** Sunk into the bar the way Windows 95 sank anything that showed a reading. */
const SUNK: React.CSSProperties = {
  border: "2px solid",
  borderColor: "#808080 #ffffff #ffffff #808080",
};

const INPUT: React.CSSProperties = {
  ...SUNK,
  width: 66,
  padding: "1px 4px",
  font: "inherit",
  fontSize: 12,
  background: "#ffffff",
  color: "#000000",
  outline: "none",
  fontVariantNumeric: "tabular-nums",
};

type MarblesBarProps = {
  seed: number;
  /**
   * A course asked for by name: a seed typed into the box, a word to stir into
   * one, or a whole code pasted in — which brings a time and a ghost with it.
   * Says whether it made sense of what it was given.
   */
  onCode: (text: string) => boolean;
  onRestart: () => void;
  onNewCourse: () => void;
  /** The quickest you have got round, which is what your code carries. */
  best: number | null;
  /** Whether the best run rides round again beside you, and the switch for it. */
  ghost: boolean;
  onGhost: (on: boolean) => void;
  /** False until there is a run on this course to ride against. */
  racing: boolean;
  /** Open the code window, which is where a course is handed on or taken up. */
  onCodeWindow: () => void;
  /** Open the help window, which is where the keys are written down. */
  onHelp: () => void;
};

export default function MarblesBar({
  seed,
  onCode,
  onRestart,
  onNewCourse,
  best,
  ghost,
  onGhost,
  racing,
  onCodeWindow,
  onHelp,
}: MarblesBarProps) {
  const [draft, setDraft] = useState(() => formatSeed(seed));
  const [shown, setShown] = useState(seed);

  // A course rolled or arrived at any other way puts its own code in the box —
  // worked out while rendering rather than in an effect, so the box never
  // shows last course's code for a frame.
  if (shown !== seed) {
    setShown(seed);
    setDraft(formatSeed(seed));
  }

  /** Raised by Escape, so that the blur it causes puts the box back instead
      of taking what is in it. */
  const cancelRef = useRef(false);

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(formatSeed(seed));
      return;
    }
    // Whatever was typed is shown back as the seed it came to, so that what is
    // in the box is always the course you are on — a whole code pasted in
    // collapses to the short one the moment it is taken up.
    if (!onCode(draft)) setDraft(formatSeed(seed));
  };

  return (
    <>
      <Button variant="menu" size="sm" title="Put the ball back on the first pad" onClick={onRestart}>
        Restart
      </Button>
      <Button variant="menu" size="sm" title="Throw this course away and roll another" onClick={onNewCourse}>
        New course
      </Button>
      {/* The course, written down. Copy it out to keep a course you liked, or
          type one in — or paste in a whole code, which brings a time and a
          ghost with it. The box is plain rather than react95's own, which
          stands a third taller than the buttons and breaks the line. */}
      <label
        title="Every course is rolled from this. Copy it to keep one, or type or paste one in and press Enter."
        style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}
      >
        Seed
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelRef.current = true;
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          style={INPUT}
        />
      </label>
      <Button
        variant="menu"
        size="sm"
        active={ghost}
        disabled={!racing}
        title={
          racing
            ? "Ride against the best run on this course — it goes round again as a little moon"
            : "Get round this course once and the run you did it in comes back as a ghost"
        }
        onClick={() => onGhost(!ghost)}
      >
        Ghost
      </Button>
      <Button
        variant="menu"
        size="sm"
        title={
          best != null
            ? "The code for this course, your time on it and the run itself — to copy out, or to paste one in"
            : "The code for this course — to copy out, or to paste one in"
        }
        onClick={onCodeWindow}
      >
        Code
      </Button>
      <Button
        variant="menu"
        size="sm"
        title="What the keys do, and the two or three rules there are"
        onClick={onHelp}
        style={{ marginLeft: "auto" }}
      >
        Help
      </Button>
    </>
  );
}
