// Pure game state and rules for tasks.exe — a Vampire-Survivors-style
// arena game where the enemies are the workday's own demands. Kept apart
// from TasksWindow.tsx so the rules can be read without the canvas/DOM
// plumbing around them, the way partyCanvas.ts sits apart from PartyWindow.
//
// Everything here is in world coordinates, which are unbounded: the player
// never hits a wall, and the window is a camera that stays centred on them.

export type EnemyKindId = "email" | "slack" | "meeting" | "bug" | "review";

export type EnemyKind = {
  id: EnemyKindId;
  label: string;
  /** What this one is here to say — one is picked per spawn, shown over its head. */
  lines: string[];
  tint: string;
  hp: number;
  speed: number;
  damage: number;
  size: number;
  xp: number;
  /** Fraction of the run's length (0–1) before this kind can spawn. */
  unlockAt: number;
  weight: number;
};

export const ENEMY_KINDS: EnemyKind[] = [
  {
    id: "email",
    label: "Email",
    lines: ["Re: Re: Re:", "Quick question", "Just following up", "Per my last email", "Any update?", "Thoughts?", "Circling back", "Adding a few people"],
    tint: "#4fa3ff",
    hp: 6, speed: 72, damage: 3, size: 26, xp: 3, unlockAt: 0, weight: 6,
  },
  {
    id: "slack",
    label: "Slack ping",
    lines: ["got a sec?", "u around?", "@here", "quick q", "sorry to bother!", "did you see my DM?", "hey", "hey :)"],
    tint: "#34d399",
    hp: 8, speed: 88, damage: 3, size: 26, xp: 3, unlockAt: 0, weight: 6,
  },
  {
    id: "meeting",
    label: "Meeting invite",
    lines: ["Sync (30m)", "No agenda", "Recurring — weekly", "Anonymous Survey", "Quick chat?", "Standup", "Calendar hold"],
    tint: "#f59e0b",
    hp: 22, speed: 42, damage: 6, size: 32, xp: 8, unlockAt: 0.15, weight: 4,
  },
  {
    id: "bug",
    label: "Urgent bug",
    lines: ["segfault", "prod is down", "URGENT", "repro attached", "works on my machine", "needs a hotfix", "customer-facing!"],
    tint: "#ef4444",
    hp: 15, speed: 104, damage: 7, size: 28, xp: 7, unlockAt: 0.32, weight: 3,
  },
  {
    id: "review",
    label: "Performance review",
    lines: ["Self-assessment", "Growth areas", "Let's align on impact", "Mandatory trainings", "Boss knows you're playing at work", "Where do you see yourself?"],
    tint: "#a855f7",
    hp: 50, speed: 34, damage: 10, size: 42, xp: 22, unlockAt: 0.65, weight: 1.5,
  },
];

/** What the auto-reply says. One is picked each time the reply goes out. */
export const REPLY_LINES = [
  "Will do!",
  "On it",
  "Nothing from my end",
  "Sounds good!",
  "+1",
  "Noted",
  "LGTM",
  "Circling back",
  "Happy to help!",
  "Per my last email",
  "Let's take this offline",
  "Looping in the team",
  "Thanks!",
  "No worries",
  "Done \u2713",
  "Following up",
];

export function enemyKind(id: EnemyKindId): EnemyKind {
  return ENEMY_KINDS.find((k) => k.id === id) ?? ENEMY_KINDS[0];
}

export type PlayerStats = {
  moveSpeed: number;
  maxHp: number;
  attackDamage: number;
  attackRange: number;
  /** How wide the reply swings, in radians, centred on where you're headed. */
  attackArc: number;
  attackInterval: number;
  /** Half-width of the cubicle: orbs inside that square drift to you. */
  cubicleSize: number;
};

export const BASE_PLAYER_STATS: PlayerStats = {
  moveSpeed: 200,
  maxHp: 130,
  attackDamage: 9,
  attackRange: 110,
  attackArc: Math.PI * 0.75,
  attackInterval: 700,
  cubicleSize: 52,
};

/** A full circle is as wide as the swing ever gets. */
export const MAX_ATTACK_ARC = Math.PI * 2;

export type Upgrade = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  apply: (stats: PlayerStats) => PlayerStats;
  /** A one-off heal, as a fraction of max HP, applied on pick. */
  healFraction?: number;
};

export const UPGRADES: Upgrade[] = [
  { id: "desk", label: "Standing Desk", emoji: "\ud83e\uddcd", description: "+15% move speed", apply: (s) => ({ ...s, moveSpeed: s.moveSpeed * 1.15 }) },
  { id: "monitor", label: "Second Monitor", emoji: "\ud83d\udda5\ufe0f", description: "+30% reply arc", apply: (s) => ({ ...s, attackArc: Math.min(MAX_ATTACK_ARC, s.attackArc * 1.3) }) },
  { id: "cubicle", label: "Corner Cubicle", emoji: "\ud83e\uddf1", description: "+25% cubicle size", apply: (s) => ({ ...s, cubicleSize: s.cubicleSize * 1.25 }) },
  { id: "coldbrew", label: "Cold Brew", emoji: "\ud83e\uddca", description: "+15% attack speed", apply: (s) => ({ ...s, attackInterval: s.attackInterval * 0.85 }) },
  { id: "espresso", label: "Double Espresso", emoji: "\u2615", description: "+20% reply damage", apply: (s) => ({ ...s, attackDamage: s.attackDamage * 1.2 }) },
  { id: "reach", label: "Wider Reach", emoji: "\ud83d\udccf", description: "+20% reply range", apply: (s) => ({ ...s, attackRange: s.attackRange * 1.2 }) },
  { id: "balance", label: "Work-Life Balance", emoji: "\u2696\ufe0f", description: "+20 max HP", apply: (s) => ({ ...s, maxHp: s.maxHp + 20 }) },
  { id: "lunch", label: "Lunch Break", emoji: "\ud83e\udd6a", description: "Heal 30% of your HP", apply: (s) => s, healFraction: 0.3 },
];

export function upgradeById(id: string): Upgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function xpForLevel(level: number): number {
  return Math.round(20 + (level - 1) * 15);
}

export const RUN_MS = 5 * 60 * 1000;
export const I_FRAME_MS = 650;
export const KNOCKBACK = 46;
export const PLAYER_RADIUS = 14;
export const COLLECT_RADIUS = 12;
export const SWING_MS = 220;
export const REPLY_TEXT_MS = 900;
export const HIT_TEXT_MS = 650;

export type Vec = { x: number; y: number };

export type Player = Vec & {
  hp: number;
  facing: 1 | -1;
  invulnUntil: number;
  /** Unit vector of the last direction moved — where the reply swings. */
  aim: Vec;
};

export type Enemy = Vec & {
  id: number;
  kind: EnemyKindId;
  /** The one thing it wants, drawn over its head. */
  line: string;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
};

export type Orb = Vec & {
  id: number;
  xp: number;
};

export type FloatingText = Vec & {
  id: number;
  text: string;
  color: string;
  bornAt: number;
};

export type GamePhase = "ready" | "playing" | "paused" | "levelup" | "gameover" | "victory";

/** One earned upgrade and how many times it has been picked. */
export type OwnedUpgrade = { upgrade: Upgrade; count: number };

export type RunState = {
  phase: GamePhase;
  player: Player;
  stats: PlayerStats;
  enemies: Enemy[];
  orbs: Orb[];
  texts: FloatingText[];
  level: number;
  xp: number;
  xpToNext: number;
  kills: number;
  elapsedMs: number;
  nextSpawnAt: number;
  nextAttackAt: number;
  /** Wall-clock time the last swing started, for drawing it. */
  swingAt: number;
  /** Direction the last swing was aimed, in radians. */
  swingAngle: number;
  /** What the last reply said, drifting up over the player's head. */
  replyLine: string;
  /** Wall-clock time the run was paused, so wall-clock timers can be shifted back. */
  pausedAt: number;
  /** Upgrade ids in the order they were first picked, with pick counts. */
  owned: string[];
  ownedCounts: Record<string, number>;
  choices: Upgrade[];
  nextId: number;
};

export function createRun(): RunState {
  return {
    phase: "ready",
    player: { x: 0, y: 0, hp: BASE_PLAYER_STATS.maxHp, facing: 1, invulnUntil: 0, aim: { x: 1, y: 0 } },
    stats: { ...BASE_PLAYER_STATS },
    enemies: [],
    orbs: [],
    texts: [],
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    kills: 0,
    elapsedMs: 0,
    nextSpawnAt: 0,
    nextAttackAt: 0,
    swingAt: -Infinity,
    swingAngle: 0,
    replyLine: "",
    pausedAt: 0,
    owned: [],
    ownedCounts: {},
    choices: [],
    nextId: 1,
  };
}

/** The earned upgrades, in the order they were first picked, for the HUD. */
export function ownedUpgrades(run: RunState): OwnedUpgrade[] {
  const list: OwnedUpgrade[] = [];
  for (const id of run.owned) {
    const upgrade = upgradeById(id);
    if (upgrade) list.push({ upgrade, count: run.ownedCounts[id] ?? 1 });
  }
  return list;
}

/** 9:00 to 5:00, mapped over the run's length, for the desk clock in the HUD. */
export function workdayClock(elapsedMs: number): string {
  const t = Math.min(1, elapsedMs / RUN_MS);
  const totalMinutes = 9 * 60 + t * 8 * 60;
  let hour = Math.floor(totalMinutes / 60);
  const minute = Math.floor(totalMinutes % 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  if (hour > 12) hour -= 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function pickKind(elapsedMs: number, rand: () => number): EnemyKind {
  const t = elapsedMs / RUN_MS;
  const open = ENEMY_KINDS.filter((k) => t >= k.unlockAt);
  const total = open.reduce((sum, k) => sum + k.weight, 0);
  let roll = rand() * total;
  for (const kind of open) {
    roll -= kind.weight;
    if (roll <= 0) return kind;
  }
  return open[open.length - 1];
}

/**
 * Spawns just off whichever edge of the view the camera is showing — the
 * arena has no walls, so "offscreen" is measured from the player outwards.
 */
export function spawnEnemy(run: RunState, width: number, height: number, rand: () => number): void {
  const kind = pickKind(run.elapsedMs, rand);
  const margin = kind.size + 24;
  const halfW = width / 2 + margin;
  const halfH = height / 2 + margin;
  const side = Math.floor(rand() * 4);
  const dx = side === 0 ? -halfW : side === 1 ? halfW : (rand() * 2 - 1) * halfW;
  const dy = side === 2 ? -halfH : side === 3 ? halfH : (rand() * 2 - 1) * halfH;
  run.enemies.push({
    id: run.nextId++,
    kind: kind.id,
    line: kind.lines[Math.floor(rand() * kind.lines.length)] ?? kind.lines[0],
    x: run.player.x + dx,
    y: run.player.y + dy,
    hp: kind.hp,
    maxHp: kind.hp,
    facing: 1,
  });
}

/** Spawns faster as the workday wears on — a quiet morning, a slammed afternoon. */
export function spawnIntervalMs(elapsedMs: number): number {
  const t = Math.min(1, elapsedMs / RUN_MS);
  return Math.max(380, 1050 - t * 670);
}

export function updatePlayer(run: RunState, dx: number, dy: number, dt: number): void {
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const speed = run.stats.moveSpeed;
  run.player.x += (dx / len) * speed * dt;
  run.player.y += (dy / len) * speed * dt;
  run.player.aim = { x: dx / len, y: dy / len };
  run.player.facing = dx < 0 ? -1 : dx > 0 ? 1 : run.player.facing;
}

export function updateEnemies(run: RunState, dt: number, now: number): void {
  for (const enemy of run.enemies) {
    const kind = enemyKind(enemy.kind);
    const dx = run.player.x - enemy.x;
    const dy = run.player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = PLAYER_RADIUS + kind.size / 2;
    if (dist > reach) {
      enemy.x += (dx / dist) * kind.speed * dt;
      enemy.y += (dy / dist) * kind.speed * dt;
      enemy.facing = dx < 0 ? -1 : 1;
    } else if (now >= run.player.invulnUntil) {
      run.player.hp -= kind.damage;
      run.player.invulnUntil = now + I_FRAME_MS;
      run.player.x -= (dx / dist) * KNOCKBACK * 0.3;
      run.player.y -= (dy / dist) * KNOCKBACK * 0.3;
      run.texts.push({ id: run.nextId++, x: run.player.x, y: run.player.y - PLAYER_RADIUS, text: `-${kind.damage}`, color: "#ff6b6b", bornAt: now });
    }
  }
}

function grantXp(run: RunState, amount: number, now: number): void {
  run.xp += amount;
  while (run.xp >= run.xpToNext) {
    run.xp -= run.xpToNext;
    run.level += 1;
    run.xpToNext = xpForLevel(run.level);
    run.phase = "levelup";
    run.choices = pickUpgrades(3);
  }
  void now;
}

function pickUpgrades(count: number): Upgrade[] {
  const pool = [...UPGRADES];
  const picked: Upgrade[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/** Shortest signed distance between two angles, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The reply swings on a fixed beat whether or not anything is in front of
 * you — an arc of `attackArc` radians, `attackRange` deep, centred on the
 * way you're moving. Scheduled in run time, so a level-up pause doesn't
 * bank a free swing.
 */
export function fireWeapon(run: RunState, now: number): boolean {
  if (run.elapsedMs < run.nextAttackAt) return false;
  run.nextAttackAt = run.elapsedMs + run.stats.attackInterval;

  const aim = Math.atan2(run.player.aim.y, run.player.aim.x);
  const half = Math.min(MAX_ATTACK_ARC, run.stats.attackArc) / 2;
  const range = run.stats.attackRange;
  run.swingAt = now;
  run.swingAngle = aim;
  run.replyLine = REPLY_LINES[Math.floor(Math.random() * REPLY_LINES.length)];

  for (const enemy of run.enemies) {
    const dx = enemy.x - run.player.x;
    const dy = enemy.y - run.player.y;
    const dist = Math.hypot(dx, dy) || 1;
    const kind = enemyKind(enemy.kind);
    if (dist - kind.size / 2 > range) continue;
    if (Math.abs(angleDelta(Math.atan2(dy, dx), aim)) > half) continue;
    enemy.hp -= run.stats.attackDamage;
    run.texts.push({ id: run.nextId++, x: enemy.x, y: enemy.y, text: `-${Math.round(run.stats.attackDamage)}`, color: "#ffe066", bornAt: now });
    enemy.x += (dx / dist) * 10;
    enemy.y += (dy / dist) * 10;
  }

  const alive: Enemy[] = [];
  for (const enemy of run.enemies) {
    if (enemy.hp > 0) {
      alive.push(enemy);
      continue;
    }
    run.kills += 1;
    const kind = enemyKind(enemy.kind);
    run.orbs.push({ id: run.nextId++, x: enemy.x, y: enemy.y, xp: kind.xp });
  }
  run.enemies = alive;
  return true;
}

/** Orbs inside the cubicle — a square, not a circle — drift over to you. */
export function updateOrbs(run: RunState, dt: number, now: number): void {
  const kept: Orb[] = [];
  const reach = run.stats.cubicleSize;
  for (const orb of run.orbs) {
    const dx = run.player.x - orb.x;
    const dy = run.player.y - orb.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < COLLECT_RADIUS) {
      grantXp(run, orb.xp, now);
      continue;
    }
    if (Math.abs(dx) <= reach && Math.abs(dy) <= reach) {
      const pull = 320;
      orb.x += (dx / dist) * pull * dt;
      orb.y += (dy / dist) * pull * dt;
    }
    kept.push(orb);
  }
  run.orbs = kept;
}

export function pruneTexts(run: RunState, now: number): void {
  run.texts = run.texts.filter((t) => now - t.bornAt < HIT_TEXT_MS);
}

export function applyUpgrade(run: RunState, upgrade: Upgrade): void {
  const beforeMax = run.stats.maxHp;
  run.stats = upgrade.apply(run.stats);
  run.player.hp += run.stats.maxHp - beforeMax;
  if (upgrade.healFraction) run.player.hp = Math.min(run.stats.maxHp, run.player.hp + run.stats.maxHp * upgrade.healFraction);
  run.player.hp = Math.min(run.stats.maxHp, run.player.hp);
  if (!run.ownedCounts[upgrade.id]) run.owned.push(upgrade.id);
  run.ownedCounts[upgrade.id] = (run.ownedCounts[upgrade.id] ?? 0) + 1;
  run.phase = "playing";
  run.choices = [];
}

/**
 * Stepping stops the moment the phase isn't "playing", so pausing is just a
 * phase — but i-frames, the swing's fade and the floating text are measured
 * against the wall clock, which keeps running. Resuming shifts them forward
 * by however long the pause lasted so nothing expires while you're reading.
 */
export function pauseRun(run: RunState, now: number): void {
  if (run.phase !== "playing") return;
  run.phase = "paused";
  run.pausedAt = now;
}

export function resumeRun(run: RunState, now: number): void {
  if (run.phase !== "paused") return;
  const away = now - run.pausedAt;
  run.player.invulnUntil += away;
  run.swingAt += away;
  for (const text of run.texts) text.bornAt += away;
  run.phase = "playing";
}

export type StatLine = {
  label: string;
  value: string;
  /** How far the upgrades have moved it from where you started. */
  delta?: string;
};

/** The player's numbers as the pause screen shows them. */
export function statLines(run: RunState): StatLine[] {
  const s = run.stats;
  const base = BASE_PLAYER_STATS;
  const pct = (now: number, then: number): string | undefined => {
    const d = Math.round((now / then - 1) * 100);
    return d === 0 ? undefined : `${d > 0 ? "+" : ""}${d}%`;
  };
  return [
    {
      label: "Health",
      value: `${Math.max(0, Math.round(run.player.hp))} / ${Math.round(s.maxHp)}`,
      delta: s.maxHp === base.maxHp ? undefined : `+${Math.round(s.maxHp - base.maxHp)} max`,
    },
    { label: "Reply damage", value: s.attackDamage.toFixed(1), delta: pct(s.attackDamage, base.attackDamage) },
    { label: "Reply every", value: `${(s.attackInterval / 1000).toFixed(2)}s`, delta: pct(base.attackInterval, s.attackInterval) },
    { label: "Reply reach", value: `${Math.round(s.attackRange)}`, delta: pct(s.attackRange, base.attackRange) },
    { label: "Reply arc", value: `${Math.round((s.attackArc * 180) / Math.PI)}\u00b0`, delta: pct(s.attackArc, base.attackArc) },
    { label: "Move speed", value: `${Math.round(s.moveSpeed)}`, delta: pct(s.moveSpeed, base.moveSpeed) },
    { label: "Cubicle", value: `${Math.round(s.cubicleSize * 2)} wide`, delta: pct(s.cubicleSize, base.cubicleSize) },
  ];
}

export function stepRun(run: RunState, dx: number, dy: number, dt: number, now: number, width: number, height: number, rand: () => number): void {
  if (run.phase !== "playing") return;

  run.elapsedMs += dt * 1000;
  updatePlayer(run, dx, dy, dt);
  updateEnemies(run, dt, now);

  if (run.player.hp <= 0) {
    run.player.hp = 0;
    run.phase = "gameover";
    return;
  }

  if (run.elapsedMs >= run.nextSpawnAt) {
    spawnEnemy(run, width, height, rand);
    run.nextSpawnAt = run.elapsedMs + spawnIntervalMs(run.elapsedMs);
  }

  fireWeapon(run, now);
  updateOrbs(run, dt, now);
  pruneTexts(run, now);

  if (run.phase === "playing" && run.elapsedMs >= RUN_MS) {
    run.phase = "victory";
  }
}
