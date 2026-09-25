"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, GroupBox, Separator, Window, WindowContent, WindowHeader } from "react95";
import { Joystick } from "@/components/windows/MpkPanel";
import { GuySheet, loadGuys, tintGuys } from "@/lib/guys";
import {
  GamePhase,
  HIT_TEXT_MS,
  OwnedUpgrade,
  PLAYER_RADIUS,
  REPLY_TEXT_MS,
  RunState,
  SWING_MS,
  StatLine,
  Upgrade,
  applyUpgrade,
  createRun,
  enemyKind,
  ownedUpgrades,
  pauseRun,
  resumeRun,
  statLines,
  stepRun,
  workdayClock,
} from "@/lib/tasksGame";

const PLAYER_TINT = "#38bdf8";
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const PAUSE_KEYS = new Set(["Escape", "KeyP"]);
/** How far the thumbstick has to be pushed before it takes over from the keys. */
const STICK_DEAD_ZONE = 0.18;

function drawFigure(
  ctx: CanvasRenderingContext2D,
  sheet: GuySheet | null,
  x: number,
  y: number,
  tint: string,
  seed: number,
  facing: 1 | -1,
  now: number,
  height: number,
) {
  const bob = Math.sin(now / 140 + seed) * 1.5;
  ctx.save();
  ctx.translate(x, y + bob);
  if (facing < 0) ctx.scale(-1, 1);
  if (sheet) {
    const guy = seed % sheet.count;
    const sx = (guy % sheet.columns) * sheet.cellWidth;
    const sy = Math.floor(guy / sheet.columns) * sheet.cellHeight;
    const w = height * (sheet.cellWidth / sheet.cellHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tintGuys(sheet, tint), sx, sy, sheet.cellWidth, sheet.cellHeight, -w / 2, -height / 2, w, height);
  } else {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, 0, height / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A little pill of text over somebody's head — what they want, or what you replied. */
function drawSpeech(ctx: CanvasRenderingContext2D, x: number, bottom: number, text: string, tint: string, px = 10) {
  ctx.font = `600 ${px}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width;
  const h = px + 5;
  const left = x - w / 2 - 5;
  const top = bottom - h;
  ctx.fillStyle = "rgba(6,10,20,0.72)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, top, w + 10, h, 3);
  else ctx.rect(left, top, w + 10, h);
  ctx.fill();
  ctx.fillStyle = tint;
  ctx.fillText(text, x, bottom - 4);
}

function drawHud(ctx: CanvasRenderingContext2D, run: RunState, width: number) {
  const barWidth = 140;
  ctx.textAlign = "left";
  ctx.font = "700 11px ui-sans-serif, system-ui, -apple-system, sans-serif";

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(10, 10, barWidth, 12);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(10, 10, barWidth * Math.max(0, run.player.hp / run.stats.maxHp), 12);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.strokeRect(10, 10, barWidth, 12);
  ctx.fillStyle = "#fff";
  ctx.fillText(`${Math.max(0, Math.round(run.player.hp))} / ${Math.round(run.stats.maxHp)}`, 16, 19);

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(10, 28, barWidth, 6);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(10, 28, barWidth * Math.min(1, run.xp / run.xpToNext), 6);
  ctx.fillStyle = "#fff";
  ctx.fillText(`Lv ${run.level}`, 10 + barWidth + 10, 20);
  ctx.fillText(`Tasks closed: ${run.kills}`, 10, 50);

  ctx.textAlign = "right";
  ctx.fillText(workdayClock(run.elapsedMs), width - 10, 19);
}

/** The cubicle walls — the square inside which loose XP drifts over to you. */
function drawCubicle(ctx: CanvasRenderingContext2D, run: RunState) {
  const half = run.stats.cubicleSize;
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(120,170,220,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(run.player.x - half, run.player.y - half, half * 2, half * 2);
  ctx.restore();
}

/** The reply itself: a wedge that sweeps across the way you're facing. */
function drawSwing(ctx: CanvasRenderingContext2D, run: RunState, now: number) {
  const t = (now - run.swingAt) / SWING_MS;
  if (t < 0 || t > 1) return;
  const arc = Math.min(Math.PI * 2, run.stats.attackArc);
  const outer = run.stats.attackRange;
  const inner = Math.max(PLAYER_RADIUS, outer * 0.32);
  const from = run.swingAngle - arc / 2;
  const swept = from + arc * Math.min(1, t * 1.6);
  const fade = 1 - t * t;

  ctx.save();
  ctx.translate(run.player.x, run.player.y);
  ctx.beginPath();
  ctx.arc(0, 0, outer, from, swept);
  ctx.arc(0, 0, inner, swept, from, true);
  ctx.closePath();
  ctx.fillStyle = `rgba(56,189,248,${0.22 * fade})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(160,225,255,${0.75 * fade})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, run: RunState, width: number, height: number, now: number, sheet: GuySheet | null) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a0c16";
  ctx.fillRect(0, 0, width, height);

  // The player never leaves the middle of the window; the floor slides past
  // underneath them instead, so the camera is just this offset.
  const camX = run.player.x - width / 2;
  const camY = run.player.y - height / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const grid = 32;
  for (let x = -((camX % grid) + grid) % grid; x < width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
  }
  for (let y = -((camY % grid) + grid) % grid; y < height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(-camX, -camY);

  if (run.phase === "ready") {
    drawFigure(ctx, sheet, run.player.x, run.player.y, PLAYER_TINT, 0, 1, now, 30);
    ctx.restore();
    return;
  }

  drawCubicle(ctx, run);

  const onScreen = (x: number, y: number, pad: number) =>
    x > camX - pad && x < camX + width + pad && y > camY - pad && y < camY + height + pad;

  for (const orb of run.orbs) {
    if (!onScreen(orb.x, orb.y, 8)) continue;
    ctx.beginPath();
    ctx.fillStyle = "#ffe066";
    ctx.arc(orb.x, orb.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const enemy of run.enemies) {
    const kind = enemyKind(enemy.kind);
    if (!onScreen(enemy.x, enemy.y, kind.size + 24)) continue;
    drawFigure(ctx, sheet, enemy.x, enemy.y, kind.tint, enemy.id, enemy.facing, now, kind.size);
    if (enemy.hp < enemy.maxHp) {
      const w = kind.size * 0.9;
      const top = enemy.y - kind.size / 2 - 10;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(enemy.x - w / 2, top, w, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(enemy.x - w / 2, top, w * Math.max(0, enemy.hp / enemy.maxHp), 4);
    }
    drawSpeech(ctx, enemy.x, enemy.y - kind.size / 2 - 14, enemy.line, kind.tint);
  }

  drawSwing(ctx, run, now);

  const flashing = now < run.player.invulnUntil && Math.floor(now / 80) % 2 === 0;
  ctx.save();
  if (flashing) ctx.globalAlpha = 0.4;
  drawFigure(ctx, sheet, run.player.x, run.player.y, PLAYER_TINT, 0, run.player.facing, now, 30);
  ctx.restore();

  const replyT = (now - run.swingAt) / REPLY_TEXT_MS;
  if (run.replyLine && replyT >= 0 && replyT <= 1) {
    ctx.globalAlpha = 1 - replyT * replyT;
    drawSpeech(ctx, run.player.x, run.player.y - 22 - replyT * 18, run.replyLine, "#dff1ff", 11);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "center";
  ctx.font = "700 12px ui-sans-serif, system-ui, -apple-system, sans-serif";
  for (const text of run.texts) {
    const age = Math.min(1, (now - text.bornAt) / HIT_TEXT_MS);
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.x, text.y - age * 20);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  drawHud(ctx, run, width);
}

/**
 * How the day is going: the clock and the tally, the numbers against the ones
 * you started with, and everything you picked up on the way. The Break window
 * and the one waiting at 5 o'clock both want exactly this.
 */
function RunReport({
  summary,
  stats,
  owned,
  emptyNote = "Nothing yet \u2014 level up and pick something.",
}: {
  summary: { kills: number; level: number; elapsedMs: number };
  stats: StatLine[];
  owned: OwnedUpgrade[];
  emptyNote?: string;
}) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
        <span>
          <strong>{workdayClock(summary.elapsedMs)}</strong> &middot; level {summary.level}
        </span>
        <span>
          {summary.kills} task{summary.kills === 1 ? "" : "s"} closed
        </span>
      </div>

      <GroupBox label="Desk stats" style={{ marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "3px 10px", fontSize: 12 }}>
          {stats.map((stat) => (
            <React.Fragment key={stat.label}>
              <span>{stat.label}</span>
              <span style={{ fontWeight: "bold" }}>{stat.value}</span>
              <span style={{ opacity: 0.65 }}>{stat.delta ?? ""}</span>
            </React.Fragment>
          ))}
        </div>
      </GroupBox>

      <GroupBox label={`Upgrades earned (${owned.reduce((n, o) => n + o.count, 0)})`}>
        {owned.length === 0 ? (
          <p style={{ fontSize: 12, margin: 0 }}>{emptyNote}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {owned.map(({ upgrade, count }, i) => (
              <React.Fragment key={upgrade.id}>
                {i > 0 && <Separator />}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
                    {upgrade.emoji}
                  </span>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 12 }}>
                      {upgrade.label} &times;{count}
                    </div>
                    <div style={{ fontSize: 11 }}>
                      {upgrade.description}
                      {count > 1 ? `, ${count} times over` : ""}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </GroupBox>
    </>
  );
}

export default function TasksWindow() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 600, height: 400 });
  const runRef = useRef<RunState>(createRun());
  const sheetRef = useRef<GuySheet | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const stickRef = useRef({ x: 0, y: 0 });

  const [phase, setPhase] = useState<GamePhase>("ready");
  const [choices, setChoices] = useState<Upgrade[]>([]);
  const [owned, setOwned] = useState<OwnedUpgrade[]>([]);
  const [stats, setStats] = useState<StatLine[]>([]);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [summary, setSummary] = useState({ kills: 0, level: 1, elapsedMs: 0 });

  useEffect(() => {
    let cancelled = false;
    loadGuys().then((sheet) => {
      if (!cancelled) sheetRef.current = sheet;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (PAUSE_KEYS.has(event.code)) {
        const run = runRef.current;
        if (run.phase === "playing") {
          pauseRun(run, performance.now());
          keysRef.current.clear();
          stickRef.current = { x: 0, y: 0 };
          setStick({ x: 0, y: 0 });
          setOwned(ownedUpgrades(run));
          setStats(statLines(run));
          setSummary({ kills: run.kills, level: run.level, elapsedMs: run.elapsedMs });
          setPhase("paused");
        } else if (run.phase === "paused") {
          resumeRun(run, performance.now());
          setPhase("playing");
        } else {
          return;
        }
        event.preventDefault();
        return;
      }
      if (!MOVE_KEYS.has(event.code)) return;
      event.preventDefault();
      keysRef.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    const blur = () => {
      keysRef.current.clear();
      stickRef.current = { x: 0, y: 0 };
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const start = useCallback(() => {
    const run = createRun();
    run.phase = "playing";
    runRef.current = run;
    // The stick unmounts with the run that ended, so its last push has to be
    // let go of here — otherwise a day that ended mid-drag starts the next one
    // already walking.
    keysRef.current.clear();
    stickRef.current = { x: 0, y: 0 };
    setStick({ x: 0, y: 0 });
    setChoices([]);
    setOwned([]);
    setStats([]);
    setPhase("playing");
  }, []);

  const counts: Record<string, number> = {};
  for (const { upgrade, count } of owned) counts[upgrade.id] = count;

  // The MPK's thumbstick reads y as up-positive; the arena's y runs the other way.
  const onStickMove = useCallback((x: number, y: number) => {
    setStick({ x, y });
    stickRef.current = { x, y: -y };
  }, []);

  const onStickRelease = useCallback(() => {
    setStick({ x: 0, y: 0 });
    stickRef.current = { x: 0, y: 0 };
  }, []);

  const pause = useCallback(() => {
    const run = runRef.current;
    if (run.phase !== "playing") return;
    pauseRun(run, performance.now());
    keysRef.current.clear();
    stickRef.current = { x: 0, y: 0 };
    setStick({ x: 0, y: 0 });
    setOwned(ownedUpgrades(run));
    setStats(statLines(run));
    setSummary({ kills: run.kills, level: run.level, elapsedMs: run.elapsedMs });
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    const run = runRef.current;
    if (run.phase !== "paused") return;
    resumeRun(run, performance.now());
    setPhase("playing");
  }, []);

  const pick = useCallback((upgrade: Upgrade) => {
    applyUpgrade(runRef.current, upgrade);
    setChoices([]);
    setOwned(ownedUpgrades(runRef.current));
    setPhase("playing");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    const held = (...codes: string[]) => codes.some((code) => keysRef.current.has(code));

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const run = runRef.current;
      const { width, height } = sizeRef.current;

      if (run.phase === "playing") {
        let dx = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
        let dy = (held("KeyS", "ArrowDown") ? 1 : 0) - (held("KeyW", "ArrowUp") ? 1 : 0);
        const stick = stickRef.current;
        if (Math.hypot(stick.x, stick.y) > STICK_DEAD_ZONE) {
          dx = stick.x;
          dy = stick.y;
        }
        stepRun(run, dx, dy, dt, now, width, height, Math.random);
        if (run.phase !== "playing") {
          setPhase(run.phase);
          setChoices(run.choices);
          setOwned(ownedUpgrades(run));
          setStats(statLines(run));
          setSummary({ kills: run.kills, level: run.level, elapsedMs: run.elapsedMs });
        }
      }

      draw(ctx, run, width, height, now, sheetRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        border: "2px solid",
        borderColor: "#808080 #ffffff #ffffff #808080",
        background: "#0a0c16",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />

      {phase === "playing" && (
        <div
          style={{ position: "absolute", left: 10, bottom: 8, pointerEvents: "auto" }}
          // Clicking the stick focuses it, and the MPK's own arrow-key nudging would
          // then fight the arrow keys already steering the player — and leave the
          // stick parked off-centre. The game owns the arrows here.
          onKeyDownCapture={(event) => event.stopPropagation()}
        >
          <Joystick
            size={68}
            x={stick.x}
            y={stick.y}
            ariaLabel="Move"
            readout=""
            onMove={onStickMove}
            onRelease={onStickRelease}
          />
        </div>
      )}

      {phase === "playing" && (
        <Button
          onClick={pause}
          size="sm"
          style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11 }}
        >
          Break (Esc)
        </Button>
      )}

      {phase !== "playing" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {phase === "ready" && (
            <Window style={{ width: "min(300px, 92%)", pointerEvents: "auto" }}>
              <WindowHeader>tasks.exe</WindowHeader>
              <WindowContent>
                <p style={{ fontSize: 12, lineHeight: 1.4, margin: "0 0 10px" }}>
                  It&rsquo;s 9 AM and everyone wants something. 
                  <br></br>
                  - Arrow keys, WASD, or joystick to move.
                  <br></br>
                  - You auto-reply in an arc in front of you. 
                  <br></br>
                  - Esc to go on break and view stats.
                  <br></br>
                  Survive to 5 PM.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button onClick={start}>Clock in</Button>
                </div>
              </WindowContent>
            </Window>
          )}

          {phase === "levelup" && (
            <Window style={{ width: "min(340px, 92%)", pointerEvents: "auto" }}>
              <WindowHeader>Level {runRef.current.level}</WindowHeader>
              <WindowContent>
                <p style={{ fontSize: 12, margin: "0 0 10px" }}>Pick one:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {choices.map((upgrade) => (
                    <Button key={upgrade.id} onClick={() => pick(upgrade)} style={{ textAlign: "left", padding: "6px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
                          {upgrade.emoji}
                        </span>
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <div style={{ fontWeight: "bold", fontSize: 12 }}>{upgrade.label}</div>
                          <div style={{ fontSize: 11 }}>{upgrade.description}</div>
                        </div>
                        {counts[upgrade.id] > 0 && (
                          <span style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>
                            have &times;{counts[upgrade.id]}
                          </span>
                        )}
                      </div>
                    </Button>
                  ))}
                </div>
                {owned.length > 0 && (
                  <p style={{ fontSize: 11, lineHeight: 1.4, margin: "10px 0 0" }}>
                    <strong>Already earned:</strong>{" "}
                    {owned
                      .map(({ upgrade, count }) => `${upgrade.emoji} ${upgrade.label} \u00d7${count}`)
                      .join(", ")}
                  </p>
                )}
              </WindowContent>
            </Window>
          )}

          {phase === "paused" && (
            <Window style={{ width: "min(400px, 94%)", maxHeight: "94%", pointerEvents: "auto", display: "flex", flexDirection: "column" }}>
              <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>🚬 Break</span>
                <Button onClick={resume} square size="sm" aria-label="Close">
                  <span className="close-icon" />
                </Button>
              </WindowHeader>
              <WindowContent style={{ overflowY: "auto", minHeight: 0 }}>
                <RunReport summary={summary} stats={stats} owned={owned} />
              </WindowContent>
            </Window>
          )}

          {phase === "gameover" && (
            <Window style={{ width: "min(400px, 94%)", maxHeight: "94%", pointerEvents: "auto", display: "flex", flexDirection: "column" }}>
              <WindowHeader>Burned out</WindowHeader>
              <WindowContent style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <p style={{ fontSize: 12, lineHeight: 1.4, margin: "0 0 10px", flex: "0 0 auto" }}>
                  Burnt out with hours still to go. Here&rsquo;s how far you got.
                </p>

                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
                  <RunReport summary={summary} stats={stats} owned={owned} emptyNote="You never got to pick anything." />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, flex: "0 0 auto" }}>
                  <Button onClick={start}>Try again</Button>
                </div>
              </WindowContent>
            </Window>
          )}

          {phase === "victory" && (
            <Window style={{ width: "min(400px, 94%)", maxHeight: "94%", pointerEvents: "auto", display: "flex", flexDirection: "column" }}>
              <WindowHeader>Clocked out</WindowHeader>
              <WindowContent style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <p style={{ fontSize: 12, lineHeight: 1.4, margin: "0 0 10px", flex: "0 0 auto" }}>
                  5 o&rsquo;clock, and you&rsquo;re still standing. Here&rsquo;s how the day went &mdash; then go home.
                </p>

                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
                  <RunReport summary={summary} stats={stats} owned={owned} emptyNote="You took nothing all day." />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, flex: "0 0 auto" }}>
                  <Button onClick={start}>Go again</Button>
                </div>
              </WindowContent>
            </Window>
          )}
        </div>
      )}
    </div>
  );
}
