"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button, Window, WindowContent, WindowHeader } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import MarblesWindow, {
  GhostState,
  MarblesWindowHandle,
  RunResult,
  readClock,
} from "@/components/windows/MarblesWindow";
import MarblesBar from "@/components/windows/MarblesBar";
import MarblesCodePanel from "@/components/windows/MarblesCodePanel";
import MarblesHelpPanel from "@/components/windows/MarblesHelpPanel";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { randomSeed, readCode, writeCode } from "@/lib/marblesShare";
import type { Trail } from "@/lib/marblesGhost";

export default function MarblesProgram(props: ProgramProps) {
  const { active = true } = props;
  const marblesRef = useRef<MarblesWindowHandle>(null);
  // Set when a course has been got round, cleared the moment the next run
  // starts. marbles.exe reports both, so this can't be left showing a time for
  // a run that is already over.
  const [marblesRun, setMarblesRun] = useState<RunResult | null>(null);
  // Which course marbles.exe is on. It is held out here rather than inside the
  // game because it is on show in the toolbar, can be typed over, and is what
  // a shared link carries — the game is handed the seed and rolls it. A fresh
  // one every time marbles.exe is opened, as it always has been.
  const [marblesSeed, setMarblesSeed] = useState(randomSeed);
  // The best time on that course, kept for the toolbar's Share to send along.
  const [marblesBest, setMarblesBest] = useState<number | null>(null);
  // A time somebody else did this course in, from the link that brought you
  // here. It belongs to one course, so rolling another puts it away.
  const [marblesTarget, setMarblesTarget] = useState<{
    seed: number;
    time: number;
    run: Trail | null;
  } | null>(null);
  // The best run riding round again beside you. On unless it is turned off,
  // and nothing to show until a course has been got round once.
  const [marblesGhost, setMarblesGhost] = useState(true);
  // Whether anything is riding this course, and your own best run on it — the
  // run your link hands on, which is not always the one you are racing.
  const [marblesRacing, setMarblesRacing] = useState(false);
  const [marblesMine, setMarblesMine] = useState<Trail | null>(null);
  // Which of marbles.exe's own little windows is up over the course.
  const [marblesCodeOpen, setMarblesCodeOpen] = useState(false);
  const [marblesHelpOpen, setMarblesHelpOpen] = useState(false);
  const handleMarblesGhosts = useCallback((state: GhostState) => {
    setMarblesRacing(state.racing);
    setMarblesMine(state.mine);
  }, []);
  const marblesToBeat = marblesTarget && marblesTarget.seed === marblesSeed ? marblesTarget.time : null;
  // The run that came with it, if one did — held steady between renders, or
  // marbles.exe would take it as a fresh arrival every time this window drew.
  // The code for where you are: this course, your best time on it, and your
  // best run. Worked out only when the code window wants it.
  const marblesCode = useMemo(
    () => writeCode(marblesSeed, marblesBest, marblesMine),
    [marblesSeed, marblesBest, marblesMine],
  );
  const marblesSent = useMemo(
    () =>
      marblesTarget && marblesTarget.seed === marblesSeed && marblesTarget.run
        ? { time: marblesTarget.time, run: marblesTarget.run }
        : null,
    [marblesTarget, marblesSeed],
  );

  const handleMarblesResult = useCallback((result: RunResult | null) => {
    setMarblesRun(result);
    if (result) setMarblesBest(result.best);
  }, []);

  const openMarblesSeed = useCallback((seed: number) => {
    setMarblesSeed(seed);
    setMarblesBest(null);
    setMarblesRun(null);
  }, []);

  // A code pasted in — in the code window, or straight into the seed box.
  // Whatever it carries is what marbles.exe switches to: the course on its
  // own, or the course with a time to beat and a ghost to race.
  const takeMarblesCode = useCallback(
    (text: string) => {
      const got = readCode(text);
      if (!got) return false;
      openMarblesSeed(got.seed);
      setMarblesTarget(
        got.beat != null ? { seed: got.seed, time: got.beat, run: got.run } : null,
      );
      return true;
    },
    [openMarblesSeed],
  );

  const toolbar = (
    <MarblesBar
      seed={marblesSeed}
      onCode={takeMarblesCode}
      onRestart={() => marblesRef.current?.restart()}
      onNewCourse={() => openMarblesSeed(randomSeed())}
      best={marblesBest}
      ghost={marblesGhost}
      onGhost={setMarblesGhost}
      racing={marblesRacing}
      onCodeWindow={() => setMarblesCodeOpen(true)}
      onHelp={() => setMarblesHelpOpen(true)}
    />
  );

  return (
    <DesktopWindow {...windowFrame("marbles", props)} toolbar={toolbar}>
      <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, display: "flex", position: "relative" }}>
        <MarblesWindow
          ref={marblesRef}
          active={active}
          seed={marblesSeed}
          ghost={marblesGhost}
          sent={marblesSent}
          onGhosts={handleMarblesGhosts}
          onResult={handleMarblesResult}
        />
        {(marblesRun || marblesCodeOpen || marblesHelpOpen) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
              // The panel takes clicks; the rest of the canvas is left alone,
              // so you can still swing the camera round the finish while you
              // decide what to do next.
              pointerEvents: "none",
            }}
          >
            {/* One panel at a time: asking for the code from the finish puts
                the code window in its place, and closing it hands the finish
                back. */}
            {marblesCodeOpen ? (
              <MarblesCodePanel
                code={marblesCode}
                carries={marblesBest != null && marblesMine ? "run" : "course"}
                onUse={takeMarblesCode}
                onClose={() => setMarblesCodeOpen(false)}
              />
            ) : marblesHelpOpen ? (
              <MarblesHelpPanel onClose={() => setMarblesHelpOpen(false)} />
            ) : marblesRun ? (
            <Window style={{ minWidth: 230, pointerEvents: "auto" }}>
              <WindowHeader style={{ display: "flex", alignItems: "center" }}>
                <span>{marblesRun.improved ? "Best time" : "Finished"}</span>
              </WindowHeader>
              <WindowContent>
                <div style={{ textAlign: "center", fontSize: 26, fontWeight: "bold", lineHeight: 1.1 }}>
                  {readClock(marblesRun.time)}
                </div>
                <div style={{ textAlign: "center", marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                  {marblesRun.improved
                    ? "round this course, and the quickest yet"
                    : `best on this course: ${readClock(marblesRun.best)}`}
                </div>
                {/* Whoever sent you the course sent a time with it, so the
                    first thing to say is whether you have taken it off them. */}
                {marblesToBeat != null && (
                  <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, fontWeight: "bold" }}>
                    {marblesRun.time < marblesToBeat
                      ? `${readClock(marblesToBeat - marblesRun.time)} quicker than the ${readClock(marblesToBeat)} you were sent`
                      : `${readClock(marblesRun.time - marblesToBeat)} off the ${readClock(marblesToBeat)} you were sent`}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "center" }}>
                  <Button onClick={() => marblesRef.current?.restart()}>Try again</Button>
                  <Button onClick={() => openMarblesSeed(randomSeed())}>Next course</Button>
                  <Button
                    title="The code for this course, your time on it and the run itself"
                    onClick={() => setMarblesCodeOpen(true)}
                  >
                    Code
                  </Button>
                </div>
              </WindowContent>
            </Window>
            ) : null}
          </div>
        )}
      </div>
    </DesktopWindow>
  );
}
