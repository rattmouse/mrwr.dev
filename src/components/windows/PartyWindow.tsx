"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DndPortrait, { portraitSprite, portraitWidth } from "@/components/windows/DndPortrait";
import FloatingPanel from "@/components/windows/FloatingPanel";
import PartyPanel from "@/components/windows/PartyPanel";
import { modifier, WALK_MS, WALK_STAGGER_MS, type Character } from "@/lib/dnd";
import { NO_LIGHTS, type FrameLights } from "@/components/windows/FrameLights";
import PartyConsole from "@/components/windows/PartyConsole";
import PartyDicePanel from "@/components/windows/PartyDicePanel";
import PartyEncountersPanel from "@/components/windows/PartyEncountersPanel";
import PartyGoingsPanel from "@/components/windows/PartyGoingsPanel";
import PartyInfoPanel, { type Picked } from "@/components/windows/PartyInfoPanel";
import {
  Dial,
  Field,
  Group,
  panelButton,
  Segmented,
  Slider,
  Stat,
} from "@/components/windows/PartyControls";
import { emojiSprite } from "@/lib/emojiSprite";
import { GuySheet, loadGuys, tintGuys } from "@/lib/guys";
import {
  applyForces,
  applyFormation,
  drawLinks,
  drawPrismTribute,
  forcesAtRest,
  formationHolding,
  holdStrength,
  isDown,
  keepWandering,
  DEFAULT_LINKS,
  LINK_ALL,
  NO_FORCES,
  NO_FORMATION,
  type Forces,
  type Formation,
  type FormationShape,
  type LinkColour,
  type Links,
  type Node,
  type PointerMode,
} from "@/lib/partyCanvas";
import {
  drawDice,
  holdTheLine,
  readRoll,
  rollInitiative,
  stepDice,
  throwDice,
  type Die,
  type DieKind,
  type Initiative,
  type Luck,
  type Roll,
} from "@/lib/partyDice";
import {
  arrivalSize,
  drawArrivals,
  rollEncounter,
  stepArrivals,
  type Arrival,
  type Encounter,
} from "@/lib/partyEncounters";
import {
  drawHits,
  drawVitals,
  goingsOn,
  stepExchanges,
  stepHits,
  NO_GOINGS,
  type Goings,
  type Hit,
} from "@/lib/partyExchanges";
import { useParty } from "@/lib/useParty";
import { usePartyLog } from "@/lib/usePartyLog";

export type PanelId =
  | "palette"
  | "motion"
  | "forces"
  | "formation"
  | "links"
  | "dice"
  | "encounters"
  | "goings"
  | "info"
  | "readout"
  | "frame"
  | "console"
  | "party";

/**
 * What the Frame panel is doing to the window around this one: 0–1 of warp,
 * and whatever it has done to the frame's lights.
 */
export type FrameSettings = { melt: number; lights: FrameLights };

export const NO_FRAME: FrameSettings = { melt: 0, lights: NO_LIGHTS };

const PANELS: { id: PanelId; label: string; title: string; width: number }[] = [
  { id: "palette", label: "Palette", title: "Palette", width: 258 },
  { id: "motion", label: "Motion", title: "Motion", width: 246 },
  { id: "forces", label: "Forces", title: "Forces", width: 258 },
  { id: "formation", label: "Formation", title: "Formation", width: 262 },
  { id: "links", label: "Links", title: "Links", width: 252 },
  { id: "dice", label: "Dice", title: "Dice", width: 262 },
  { id: "encounters", label: "Encounters", title: "Encounters", width: 274 },
  { id: "goings", label: "Goings-on", title: "Goings-on", width: 300 },
  { id: "info", label: "Info", title: "Info", width: 286 },
  { id: "readout", label: "Readout", title: "Readout", width: 214 },
  { id: "frame", label: "Frame", title: "Frame", width: 246 },
  { id: "console", label: "Console", title: "Console", width: 306 },
  { id: "party", label: "Party", title: "Party", width: 322 },
];

const ACCENTS = ["#eeeeee", "#00ffff", "#ffff00", "#8ace00","#f0927e", "#ff7e30" ] as const;
const SURFACES = [
  { label: "Ink", value: "#0b0e14" },
  { label: "Slate", value: "#161a23" },
  { label: "Mist", value: "#e7ebf2" },
] as const;

type NodeShape = "guys" | "rat" | "mouse" | "dots";

// The two emoji the canvas can be populated with instead of the painted crowd.
const EMOJI: Partial<Record<NodeShape, string>> = { rat: "🐀", mouse: "🐁" };
const SHAPE_NAMES: Record<NodeShape, string> = {
  guys: "guy",
  rat: "rat",
  mouse: "mouse",
  dots: "dot",
};

type Settings = {
  accent: string;
  surface: string;
  density: number;
  speed: number;
  reach: number;
  /** 0 = the canvas is wiped every frame; up towards 1 the crowd smears. */
  trails: number;
  /** Let the crowd past the frame to wander the desktop behind the windows. */
  loose: boolean;
  shape: NodeShape;
  /** What the Forces panel is pushing the crowd around with. */
  forces: Forces;
  /** The shape the Formation panel has told the crowd to stand in. */
  formation: Formation;
  /** What the Links panel is doing to the lines strung between them. */
  links: Links;
};

// What one node has been told to be, as against what the crowd around it is.
type NodeOverride = { shape?: NodeShape; color?: string };

const DEFAULTS: Settings = {
  accent: ACCENTS[0],
  surface: SURFACES[0].value,
  density: 50,
  speed: 0.5,
  reach: 150,
  trails: 0,
  loose: false,
  shape: "guys",
  forces: NO_FORCES,
  formation: NO_FORMATION,
  links: DEFAULT_LINKS,
};

// What the Console calls each setting, and how its value reads there — the log
// is written for someone watching the window, so "trails 0 → 40" rather than
// "trails 0 → 0.4", and "nodes guy → rat" rather than the value behind it.
const SETTING_LABEL: Record<keyof Settings, string> = {
  accent: "accent",
  surface: "surface",
  density: "density",
  speed: "speed",
  reach: "reach",
  trails: "trails",
  loose: "crowd",
  shape: "nodes",
  forces: "forces",
  formation: "formation",
  links: "links",
};

const FORCE_LABEL: Record<keyof Forces, string> = {
  gravityAngle: "gravity heading",
  gravity: "gravity",
  wind: "wind",
  jitter: "jitter",
  pointer: "pointer",
  pull: "pointer force",
  separation: "separation",
  alignment: "alignment",
  cohesion: "cohesion",
};

const FORMATION_LABEL: Record<keyof Formation, string> = {
  shape: "formation",
  hold: "hold",
  restless: "restless",
};

const LINK_LABEL: Record<keyof Links, string> = {
  opacity: "link opacity",
  weight: "link weight",
  max: "links per node",
  curve: "curve",
  colour: "link colour",
  mesh: "mesh",
};

const percent = (value: number) => Math.round(value * 100);

const showSetting = (key: keyof Settings, value: Settings[keyof Settings]) => {
  if (key === "loose") return value ? "let out" : "kept in";
  if (key === "trails") return `${percent(value as number)}`;
  if (key === "surface") return (SURFACES.find((s) => s.value === value)?.label ?? "").toLowerCase();
  if (key === "shape") return SHAPE_NAMES[value as NodeShape];
  return String(value);
};

const showForce = (key: keyof Forces, value: Forces[keyof Forces]) =>
  key === "gravityAngle"
    ? `${Math.round(value as number)}°`
    : typeof value === "number"
      ? `${percent(value)}`
      : String(value);

const showFormation = (key: keyof Formation, value: Formation[keyof Formation]) => {
  if (key === "shape") return String(value);
  return `${percent(value as number)}`;
};

const showLink = (key: keyof Links, value: Links[keyof Links]) => {
  if (key === "max") return value === LINK_ALL ? "all" : String(value);
  if (key === "weight") return (value as number).toFixed(1);
  if (key === "colour") return String(value);
  return `${percent(value as number)}`;
};

const nameOf = (character: Character) => character.name.trim() || "someone unnamed";

// How tall a guy stands on the canvas, before his own size roll. A party member
// stands a little taller than the crowd — the loadout tile has more in it.
const GUY_HEIGHT = 26;
const PARTY_HEIGHT = 34;

const heightOf = (node: Node) => (node.charId ? PARTY_HEIGHT : GUY_HEIGHT) * node.size;

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

// A light surface needs dark ink on it and the other way round; everything the
// canvas draws is one of these two plus the accent.
const isLight = (hex: string) => {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
};

// The palette is picked to glow on a dark canvas, which leaves it washed out on
// a pale one — so on Mist the same accent is taken down towards ink.
const deepen = (hex: string, amount: number) => {
  const [r, g, b] = channels(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

/**
 * party.webp: a canvas of drifting nodes that reach for the pointer, with a
 * strip of menus along the top. Each menu opens a tool window that floats free
 * of this frame — they drag anywhere on the desktop and always sit above it —
 * and every control in them writes straight into what the canvas is drawing.
 *
 * One of those tools is the Party: roll up an adventurer, Save them, and they
 * join the drift as a node of their own — clickable, named, and gone with the
 * rest of the party when its ten minutes are up.
 *
 * The frame around it is the usual Windows 95 dressing; everything inside is
 * deliberately not.
 */
type PartyWindowProps = {
  frame: FrameSettings;
  /**
   * Change part of what the Frame panel is doing. It is a patch rather than a
   * whole settings object so that two controls firing before a re-render — the
   * warp and the lights, say — cannot each write back the other's old value.
   */
  onFrameChange: (patch: Partial<FrameSettings>) => void;
};

export default function PartyWindow({ frame, onFrameChange }: PartyWindowProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  // Open panels, back to front: the last one is on top, and clicking any panel
  // moves it to the end.
  const [stack, setStack] = useState<PanelId[]>([]);
  const [stats, setStats] = useState({ fps: 0, nodes: 0, x: 0, y: 0 });
  // The node under the last click, and what has been done to individual nodes.
  // Both are kept in React state so the panels can show them, and mirrored into
  // refs so the draw loop can read them without re-subscribing.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The picked node's character, when the thing picked was a party member.
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  // Or the one that wandered in, when that is what was clicked. It is its own
  // piece of state rather than another kind of selected id because arrivals and
  // nodes are numbered from two different counters and could collide.
  const [selectedArrival, setSelectedArrival] = useState<number | null>(null);
  // Everything the Info panel says about whichever of them is picked, read off
  // the canvas along with the rest of the readout.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [overrides, setOverrides] = useState<Record<number, NodeOverride>>({});

  const party = useParty();
  const log = usePartyLog();

  // What the Dice panel is set to, what it has rolled, and what is presently
  // bouncing about on the canvas. The dice themselves live in a ref like the
  // crowd does — they are moved sixty times a second, and nothing in React
  // needs to hear about it.
  const [die, setDie] = useState<DieKind>("d20");
  const [luck, setLuck] = useState<Luck>("normal");
  const [rolls, setRolls] = useState<Roll[]>([]);
  const diceRef = useRef<Die[]>([]);
  const nextDieId = useRef(1);
  const initiativeRef = useRef<Initiative | null>(null);
  // Rolls waiting for their dice to stop bouncing before they are read out.
  const settling = useRef(new Set<number>());

  // Who is out on the canvas, and what has happened so far.
  const arrivalsRef = useRef<Arrival[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [visiting, setVisiting] = useState(0);
  // The numbers lifting off whoever they happened to, and the account of it
  // all that the Goings-on panel reads. The numbers live in a ref like the
  // crowd and the dice do; the account is taken off the canvas four times a
  // second, which is as often as anyone can read it.
  const hitsRef = useRef<Hit[]>([]);
  const [goings, setGoings] = useState<Goings>(NO_GOINGS);
  // Only so the panel can grey the button out while the party is lining up.
  const [liningUp, setLiningUp] = useState(false);
  // Pulled out so the effects below can depend on it: the log itself is a new
  // object every time a line is written, this is the same function throughout.
  const { note } = log;
  // And mirrored into a ref for the draw loop, which is set up once and never
  // torn down — the fight on the canvas has things to say about itself.
  const noteRef = useRef(note);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);
  // Who is mid-walk-off and where each of them set out from, in viewport px —
  // taken from where they were standing on the canvas when the clock ran out.
  const [walk, setWalk] = useState<{
    members: Character[];
    spots: Record<string, { x: number; y: number }>;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The canvas lying over the desktop that the crowd wanders onto once it has
  // been let out of the window. It is always mounted — the draw loop is set up
  // once and never torn down, so it can't be handed a canvas that comes and
  // goes with the switch.
  const looseRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const pointerRef = useRef<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });
  // Raised by the Motion panel's Wipe clean; the draw loop lowers it again on
  // the frame it clears in full.
  const wipeRef = useRef(false);
  // The draw loop reads settings through a ref so moving a slider never has to
  // tear down and restart the animation.
  const guysRef = useRef<GuySheet | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);
  const selectedRef = useRef<number | null>(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const selectedArrivalRef = useRef<number | null>(selectedArrival);
  useEffect(() => {
    selectedArrivalRef.current = selectedArrival;
  }, [selectedArrival]);
  const nextNodeId = useRef(1);
  // The party's own nodes, kept apart from the crowd so the density slider
  // never thins a member away, plus where each of them last stood.
  const partyRef = useRef<Node[]>([]);
  const rosterRef = useRef<Character[]>(party.roster);
  useEffect(() => {
    rosterRef.current = party.roster;
  }, [party.roster]);
  const partyPosRef = useRef(new Map<string, { x: number; y: number }>());

  // The canvas' own size, for throwing a die onto it. The wrap element is what
  // the canvas is sized from, so it is the honest answer even mid-resize.
  const canvasSize = () => {
    const box = wrapRef.current?.getBoundingClientRect();
    return { width: Math.max(80, box?.width ?? 600), height: Math.max(80, box?.height ?? 360) };
  };

  const roll = () => {
    const now = performance.now();
    const { width, height } = canvasSize();
    const { dice, roll: rolled } = throwDice(die, luck, width, height, now, () => nextDieId.current++);
    diceRef.current.push(...dice);
    // The number is settled before the die is ever thrown, but nobody wants to
    // be told it while the thing is still bouncing — so the panel and the log
    // wait for it to come to rest, the same as you would.
    const lands = Math.max(...dice.map((d) => d.restsAt)) - now + 140;
    const timer = window.setTimeout(() => {
      settling.current.delete(timer);
      setRolls((prev) => [...prev, rolled].slice(-40));
      note(`rolled ${readRoll(rolled)}`);
    }, lands);
    settling.current.add(timer);
  };

  const rollForInitiative = () => {
    if (party.roster.length === 0) return;
    const { initiative, lines } = rollInitiative(
      party.roster.map((c) => ({ id: c.id, name: c.name.trim() || "unnamed", dex: modifier(c.scores.dex) })),
      performance.now(),
    );
    initiativeRef.current = initiative;
    setLiningUp(true);
    note("rolled for initiative");
    for (const line of lines) note(line);
  };

  const rollAnEncounter = () => {
    const { width, height } = canvasSize();
    const { arrival, encounter } = rollEncounter(width, height, performance.now(), () =>
      nextDieId.current++,
    );
    arrivalsRef.current.push(arrival);
    setEncounters((prev) => [encounter, ...prev].slice(0, 24));
    setVisiting(arrivalsRef.current.length);
    note(`a ${encounter.who} — ${encounter.hook}`);
  };

  const sendThemAway = () => {
    const gone = arrivalsRef.current.length;
    if (gone === 0) return;
    arrivalsRef.current.length = 0;
    setVisiting(0);
    note(gone > 1 ? `${gone} of them sent away` : "sent away");
  };

  const clearPick = useCallback(() => {
    setSelectedId(null);
    setSelectedChar(null);
    setSelectedArrival(null);
  }, []);

  const panelName = (id: PanelId) => PANELS.find((p) => p.id === id)?.label.toLowerCase() ?? id;
  const openPanel = (id: PanelId) => {
    note(`${panelName(id)} panel ${stack.includes(id) ? "closed" : "opened"}`);
    setStack((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };
  const focusPanel = useCallback(
    (id: PanelId) => setStack((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((p) => p !== id), id])),
    [],
  );
  const closePanel = useCallback(
    (id: PanelId) => {
      note(`${PANELS.find((p) => p.id === id)?.label.toLowerCase() ?? id} panel closed`);
      setStack((prev) => prev.filter((p) => p !== id));
    },
    [note],
  );

  // The tool windows can borrow the desktop's frame — border and title bar, and
  // no more of it than that. party.webp is a modern window in old dressing;
  // this is the same joke told about its panels, and the switch is below.
  const [dressPanels, setDressPanels] = useState(false);

  // Where each tool window was last put down. A panel you close and open again
  // comes back where you left it; the slot below is only ever the opening
  // position for one that has not been moved yet. Like the rest of this
  // window's state it lasts as long as the window does.
  const [spots, setSpots] = useState<Partial<Record<PanelId, { x: number; y: number }>>>({});
  const rememberSpot = useCallback(
    (id: PanelId, at: { x: number; y: number }) => setSpots((prev) => ({ ...prev, [id]: at })),
    [],
  );

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (settings[key] !== value) {
      log.changed(key, SETTING_LABEL[key], showSetting(key, settings[key]), showSetting(key, value));
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Forces and Links are written a field at a time, the same way the Frame
  // panel's lights are: two controls moved before a re-render can't then each
  // write back the other's old value.
  const setForce = <K extends keyof Forces>(key: K, value: Forces[K]) => {
    if (settings.forces[key] !== value) {
      log.changed(
        `forces.${key}`,
        FORCE_LABEL[key],
        showForce(key, settings.forces[key]),
        showForce(key, value),
      );
    }
    setSettings((prev) => ({ ...prev, forces: { ...prev.forces, [key]: value } }));
  };
  const setForm = <K extends keyof Formation>(key: K, value: Formation[K]) => {
    if (settings.formation[key] !== value) {
      log.changed(
        `formation.${key}`,
        FORMATION_LABEL[key],
        showFormation(key, settings.formation[key]),
        showFormation(key, value),
      );
    }
    setSettings((prev) => ({ ...prev, formation: { ...prev.formation, [key]: value } }));
  };
  const setLink = <K extends keyof Links>(key: K, value: Links[K]) => {
    if (settings.links[key] !== value) {
      log.changed(
        `links.${key}`,
        LINK_LABEL[key],
        showLink(key, settings.links[key]),
        showLink(key, value),
      );
    }
    setSettings((prev) => ({ ...prev, links: { ...prev.links, [key]: value } }));
  };
  const { forces, formation, links } = settings;

  // Turning Colour up from nothing lights the frame and sets it moving, rather
  // than handing back a frame that is lit but stone still and looks broken.
  const setLights = (patch: Partial<FrameLights>) =>
    onFrameChange({
      lights:
        patch.colour !== undefined && patch.colour > 0 && frame.lights.colour === 0
          ? { colour: patch.colour, cycle: 0.4, pulse: 0.35, strobe: 0 }
          : { ...frame.lights, ...patch },
    });

  // With a node picked, the Palette's controls work on that one; with nothing
  // picked they work on the crowd, exactly as they did before. The controls
  // themselves are the same either way — they just show, and write, whichever
  // of the two is in scope.
  // A party member is a node like any other, but the Palette is not where they
  // are dressed — their sheet is. So the per-node controls only take hold on
  // the crowd, and picking a member sends you to the Party panel instead.
  const selectedCharacter =
    selectedChar === null ? null : (party.roster.find((c) => c.id === selectedChar) ?? null);
  const editable = selectedId !== null && selectedCharacter === null;
  const selectedOverride = !editable || selectedId === null ? null : (overrides[selectedId] ?? {});
  const activeAccent = selectedOverride?.color ?? settings.accent;
  const activeShape = selectedOverride?.shape ?? settings.shape;
  const editSelected = (patch: NodeOverride) => {
    if (selectedId === null) return;
    setOverrides((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], ...patch } }));
  };
  const resetSelected = () => {
    if (selectedId === null) return;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  };
  const edited = Object.keys(overrides).length;

  // The sprite sheet is fetched the first time the canvas actually wants guys —
  // whether that is the whole crowd or a single node told to be one.
  // Party members are painted figures whatever the crowd has been set to, so
  // anyone on the roster wants the sheet as much as a canvas full of guys does.
  const wantsGuys =
    settings.shape === "guys" ||
    party.roster.length > 0 ||
    Object.values(overrides).some((o) => o.shape === "guys");
  useEffect(() => {
    if (!wantsGuys || guysRef.current) return;
    let cancelled = false;
    void loadGuys().then((sheet) => {
      if (!cancelled) guysRef.current = sheet;
    });
    return () => {
      cancelled = true;
    };
  }, [wantsGuys]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    // Whether the surface has been laid down opaquely at least once since the
    // canvas was last sized, the surface it was laid down in, and a count of
    // the frames drawn over it. All three belong to the clear step in draw().
    let primed = false;
    let lastSurface = "";
    // Whether the desktop's canvas is currently blank — it is, until the crowd
    // is let out, and it is wiped back to blank when they are shut in again.
    let looseWasOff = true;
    let toppedUpAt = 0;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const previousWidth = width;
      const previousHeight = height;
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));

      // Carry the crowd with the canvas when the window is resized or
      // maximized, instead of leaving everyone huddled in the old corner.
      if (previousWidth > 0 && previousHeight > 0) {
        const scaleX = width / previousWidth;
        const scaleY = height / previousHeight;
        for (const node of nodesRef.current) {
          node.x *= scaleX;
          node.y *= scaleY;
        }
      }

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing the canvas blanks it to transparent, so the next frame has to
      // lay the surface down in full before it can start fading it.
      primed = false;
    };

    const bornNode = (): Node => ({
      id: nextNodeId.current++,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.random() * 2 - 1,
      vy: Math.random() * 2 - 1,
      guy: Math.floor(Math.random() * 1e6),
      flip: Math.random() < 0.5,
      size: 0.78 + Math.random() * 0.5,
    });

    const spawn = (count: number) => {
      const nodes = nodesRef.current;
      while (nodes.length > count) nodes.pop();
      while (nodes.length < count) nodes.push(bornNode());
    };

    // A party member is a node too: one walks onto the canvas when they are
    // saved, and off it when they are struck from the roster or the party goes.
    // They never face backwards — the loadout tile reads wrong mirrored.
    const syncParty = () => {
      const members = rosterRef.current;
      const party = partyRef.current;
      for (let i = party.length - 1; i >= 0; i -= 1) {
        if (!members.some((m) => m.id === party[i].charId)) party.splice(i, 1);
      }
      for (const member of members) {
        if (party.some((n) => n.charId === member.id)) continue;
        party.push({ ...bornNode(), flip: false, charId: member.id });
      }
    };

    fit();
    spawn(DEFAULTS.density);

    const observer = new ResizeObserver(() => fit());
    observer.observe(wrap);

    let frame = 0;
    let last = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;
    let statsAt = last;

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      const dt = Math.min(now - last, 50);
      last = now;

      const { accent, surface, density, speed, reach, trails, loose, shape, forces, formation, links } =
        settingsRef.current;
      // Both canvases clear on the same Wipe clean, so the flag is read here
      // and lowered at the end of the frame rather than by whichever of them
      // happens to get to it first.
      const wiping = wipeRef.current;
      spawn(density);
      syncParty();
      // The crowd and the party drift, link and are picked as one lot; they are
      // only kept in two arrays so the density slider can't cull a member.
      const nodes = nodesRef.current.concat(partyRef.current);
      const light = isLight(surface);
      const ink = light ? "15, 20, 30" : "232, 236, 244";
      const step = (dt / 16.67) * speed;

      // With Trails down this is the ordinary wipe: the surface goes on solid
      // and nothing survives the frame. Turn it up and the surface goes on
      // sheer instead, so what was drawn last frame is still faintly under it
      // and the crowd smears rather than moves.
      //
      // A sheer fill has to be laid over something, so the surface goes on
      // solid once first — after a resize, a change of surface, or Wipe clean.
      ctx.fillStyle = surface;
      const fresh = !primed || wiping || surface !== lastSurface || trails <= 0;
      if (fresh) {
        ctx.fillRect(0, 0, width, height);
        primed = true;
        lastSurface = surface;
      } else {
        // The fade is raised to dt so a trail is as long on a 144Hz screen as
        // it is on a 60Hz one, and the top-up is on a clock for the same
        // reason. It is there because a fill this sheer moves an 8-bit channel
        // by less than half a level once a ghost is close to the surface,
        // which rounds to no change at all and leaves the last of every trail
        // burnt into the canvas for good — on Ink it stalls around #191919
        // rather than reaching #0b0e14. Three times a second the fill goes on
        // harder than asked, which is what finally takes it off, and that is
        // far too sparse to see.
        const fade = 1 - Math.pow(1 - Math.pow(0.03, trails), dt / 16.67);
        const topUp = now - toppedUpAt > 330;
        if (topUp) toppedUpAt = now;
        ctx.globalAlpha = topUp ? Math.max(fade, 0.12) : fade;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }

      // Whatever the Forces panel is doing lands on vx/vy first; the step below
      // is the same one it always was, and with every force at rest it moves
      // the crowd exactly as it used to.
      const pointer = pointerRef.current;
      applyForces(nodes, forces, { step, now, reach, pointer });
      applyFormation(nodes, formation, { step, now, width, height });
      // Whatever the shape has let go of, the old aimless wander takes back —
      // and anyone a die or an arrival has thrown is walked back down to a
      // stroll, unless the Forces panel is the one doing the throwing.
      keepWandering(
        nodes,
        step,
        1 - Math.min(1, holdStrength(formation, now)),
        forcesAtRest(forces),
      );
      // A die crossing the canvas shoves whoever it passes out of the way; a
      // monster on it sends the crowd running while the party closes in, and a
      // guest gathers everybody in together.
      stepDice(diceRef.current, nodes, { step, now, width, height });
      // Whoever has wandered in gets their frame of everyone before they are
      // moved and, if their time is up, taken off the canvas — that order is
      // what lets somebody be seen off in the log on the way out.
      stepExchanges(arrivalsRef.current, nodes, hitsRef.current, {
        step,
        now,
        memberOf: (id) => rosterRef.current.find((member) => member.id === id),
        nextId: () => nextDieId.current++,
        note: (line) => noteRef.current(line),
      });
      stepArrivals(arrivalsRef.current, nodes, { step, now, width, height });
      stepHits(hitsRef.current, { frames: dt / 16.67, now });
      const initiative = initiativeRef.current;
      if (initiative) {
        if (now > initiative.until) initiativeRef.current = null;
        else holdTheLine(partyRef.current, initiative, { step, now, width, height });
      }

      // Where the window is sitting on the desktop, which is what turns a
      // place on this canvas into a place on the screen. Only wanted when the
      // crowd has been let out, and it costs a layout read, so it is only
      // taken then.
      const out = loose ? looseRef.current : null;
      const outCtx = out?.getContext("2d") ?? null;
      const at = out ? wrap.getBoundingClientRect() : null;

      // Let out, the crowd's world is the whole screen rather than the window:
      // they carry on past the frame and come back round at the far edge of
      // the desktop instead of the far edge of the canvas.
      const left = at ? -at.left - reach : -reach;
      const right = at ? window.innerWidth - at.left + reach : width + reach;
      const top = at ? -at.top - reach : -reach;
      const bottom = at ? window.innerHeight - at.top + reach : height + reach;

      // A crowd holding a shape is never wrapped round the edges: someone who
      // has strayed a little past the border is walking back in, and sending
      // them the long way round instead would be a poor way to assemble a ring.
      const wraps = !formationHolding(formation, now);
      for (const node of nodes) {
        node.x += node.vx * step;
        node.y += node.vy * step;
        // Wrap rather than bounce, so nothing piles up along the edges.
        if (!wraps) continue;
        if (node.x < left) node.x = right;
        if (node.x > right) node.x = left;
        if (node.y < top) node.y = bottom;
        if (node.y > bottom) node.y = top;
      }

      const sheet = guysRef.current;
      const nodeOverrides = overridesRef.current;
      // Each colour only has to be taken down for a pale surface once a frame,
      // however many nodes are wearing it.
      const tones = new Map<string, string>();
      const toneOf = (hex: string) => {
        let tone = tones.get(hex);
        if (!tone) {
          tone = light ? deepen(hex, 0.45) : hex;
          tones.set(hex, tone);
        }
        return tone;
      };

      // Everything below is drawn once into the window's own canvas and,
      // when the crowd has been let out, a second time into the canvas lying
      // over the desktop — same crowd, same lines, shifted to wherever the
      // window happens to be sitting.
      // Put the canvas over one of the crowd, ready to draw them: the right way
      // round or the other way round, and on their back if that is where
      // something has put them.
      const stand = (into: CanvasRenderingContext2D, node: Node, flat: boolean) => {
        into.translate(node.x, node.y);
        if (flat) {
          into.globalAlpha = 0.45;
          into.rotate(Math.PI / 2);
        }
        // Half of them face the other way, so the crowd isn't a chorus line.
        if (node.flip) into.scale(-1, 1);
      };

      const paint = (into: CanvasRenderingContext2D) => {
        if (formation.shape === "triangle") {
          drawPrismTribute(into, { width, height, strength: holdStrength(formation, now) });
        }
        drawLinks(into, nodes, {
          reach,
          links,
          ink,
          // Toned for a pale surface like everything else the canvas draws, or
          // the lines wash out of Mist entirely.
          accent: toneOf(accent),
          pointer,
          // A party member is painted in the palette's colour whatever the crowd
          // around them has been dressed in, so their links are too.
          colourOf: (node) => toneOf(node.charId ? accent : (nodeOverrides[node.id]?.color ?? accent)),
        });

        const byId = new Map(rosterRef.current.map((member) => [member.id, member] as const));

        for (const node of nodes) {
          if (node.charId) {
            const member = byId.get(node.charId);
            if (!member) continue;
            // Remembered for the walk-off, which sets out from where they stood.
            partyPosRef.current.set(node.charId, { x: node.x, y: node.y });

            const h = heightOf(node);
            // Knocked flat by something that wandered in: drawn lying where
            // they fell, and faintly, until they come round.
            const flat = isDown(node);
            const sprite = portraitSprite(member, toneOf(accent), sheet);
            if (sprite) {
              const w = portraitWidth(h);
              into.save();
              // The tile is 24×31 actual pixels; smoothing turns it to mush.
              into.imageSmoothingEnabled = false;
              if (flat) {
                into.globalAlpha = 0.5;
                into.translate(node.x, node.y);
                into.rotate(Math.PI / 2);
                into.drawImage(sprite, -w / 2, -h / 2, w, h);
              } else {
                into.drawImage(sprite, node.x - w / 2, node.y - h / 2, w, h);
              }
              into.restore();
            }
            // Their name under them, so a party reads as a party and not as five
            // more of the crowd.
            into.font = "10px ui-sans-serif, system-ui, -apple-system, sans-serif";
            into.textAlign = "center";
            into.fillStyle = `rgba(${ink}, ${flat ? 0.4 : 0.72})`;
            into.fillText(member.name.trim() || "unnamed", node.x, node.y + h / 2 + 11);

            // Rolled for initiative, everyone carries their number over their
            // head for as long as the order stands.
            const rolled = initiativeRef.current?.scores[node.charId];
            if (rolled) {
              into.font = "700 11px ui-sans-serif, system-ui, -apple-system, sans-serif";
              into.fillStyle = toneOf(accent);
              into.fillText(String(rolled.total), node.x, node.y - h / 2 - 6);
            }
            continue;
          }

          const override = nodeOverrides[node.id];
          const nodeShape = override?.shape ?? shape;
          const tone = toneOf(override?.color ?? accent);
          const h = GUY_HEIGHT * node.size;
          const emoji = EMOJI[nodeShape];
          // One of the crowd who got in the way of something: on their back,
          // and faint, until they pick themselves up.
          const flat = isDown(node);

          if (emoji) {
            const sprite = emojiSprite(emoji);
            if (!sprite) continue;
            into.save();
            stand(into, node, flat);
            into.drawImage(sprite, -h / 2, -h / 2, h, h);
            into.restore();
          } else if (nodeShape === "guys" && sheet) {
            const guy = node.guy % sheet.count;
            const sx = (guy % sheet.columns) * sheet.cellWidth;
            const sy = Math.floor(guy / sheet.columns) * sheet.cellHeight;
            const w = h * (sheet.cellWidth / sheet.cellHeight);
            into.save();
            stand(into, node, flat);
            into.drawImage(
              tintGuys(sheet, tone),
              sx,
              sy,
              sheet.cellWidth,
              sheet.cellHeight,
              -w / 2,
              -h / 2,
              w,
              h,
            );
            into.restore();
          } else {
            into.save();
            into.globalAlpha = flat ? 0.45 : 1;
            into.fillStyle = tone;
            into.beginPath();
            into.arc(node.x, node.y, 1.8, 0, Math.PI * 2);
            into.fill();
            into.restore();
          }
        }

        drawArrivals(into, arrivalsRef.current, {
          now,
          ink,
          accent: toneOf(accent),
          sprite: emojiSprite,
        });
        // What anybody in a scrap has left of themselves, and only for those
        // who have lost some of it.
        drawVitals(into, nodes, arrivalsRef.current, { now, ink, light, heightOf });
        drawDice(into, diceRef.current, { now, accent: toneOf(accent), ink, surface });

        // Whatever is picked wears a marching-ants ring, in the palette's own
        // colour rather than its own, so it stands out however it is dressed.
        const ring = (x: number, y: number, radius: number) => {
          into.save();
          into.strokeStyle = accent;
          into.lineWidth = 1.5;
          into.setLineDash([4, 4]);
          into.lineDashOffset = -((now / 45) % 8);
          into.beginPath();
          into.arc(x, y, radius, 0, Math.PI * 2);
          into.stroke();
          into.restore();
        };
        const selected = selectedRef.current;
        if (selected !== null) {
          const node = nodes.find((n) => n.id === selected);
          if (node) ring(node.x, node.y, heightOf(node) / 2 + 7);
        }
        const visitor = selectedArrivalRef.current;
        if (visitor !== null) {
          const arrival = arrivalsRef.current.find((a) => a.id === visitor);
          if (arrival) ring(arrival.x, arrival.y, arrivalSize(arrival) / 2 + 9);
        }

        // Last of all, over the lot of them: the numbers lifting off whoever
        // they happened to. They are the only way to see any of the arithmetic,
        // so nothing gets to be drawn on top of them.
        drawHits(into, hitsRef.current, { now, ink, light, surface });
      };

      paint(ctx);

      // The desktop's canvas has to stay see-through — there is a desktop under
      // it — so where the window lays its surface down again this erases what
      // was there instead, and trails are the same erasure done gently.
      if (out && outCtx && at) {
        const dpr = window.devicePixelRatio || 1;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (out.width !== Math.round(vw * dpr) || out.height !== Math.round(vh * dpr)) {
          out.width = Math.round(vw * dpr);
          out.height = Math.round(vh * dpr);
          out.style.width = `${vw}px`;
          out.style.height = `${vh}px`;
          looseWasOff = true;
        }
        outCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (fresh || looseWasOff) {
          outCtx.clearRect(0, 0, vw, vh);
        } else {
          outCtx.save();
          outCtx.globalCompositeOperation = "destination-out";
          outCtx.globalAlpha = 1 - Math.pow(1 - Math.pow(0.03, trails), dt / 16.67);
          outCtx.fillStyle = "#000";
          outCtx.fillRect(0, 0, vw, vh);
          outCtx.restore();
        }
        looseWasOff = false;
        outCtx.save();
        outCtx.translate(at.left, at.top);
        paint(outCtx);
        outCtx.restore();
      } else if (!looseWasOff) {
        // Shut the crowd back in and whatever was left on the desktop goes.
        const stale = looseRef.current;
        const staleCtx = stale?.getContext("2d");
        if (stale && staleCtx) staleCtx.clearRect(0, 0, stale.width, stale.height);
        looseWasOff = true;
      }

      wipeRef.current = false;
      fpsAccum += dt;
      fpsFrames += 1;
      if (now - statsAt > 250) {
        statsAt = now;
        const fps = fpsFrames > 0 ? Math.round(1000 / (fpsAccum / fpsFrames)) : 0;
        fpsAccum = 0;
        fpsFrames = 0;
        setStats({
          fps,
          nodes: nodes.length,
          x: Math.round(pointer.x),
          y: Math.round(pointer.y),
        });
        // Turning the density down can thin away the node that was picked, and
        // whatever wandered in wanders off again on its own clock.
        const pickedId = selectedRef.current;
        const pickedNode = pickedId === null ? null : nodes.find((n) => n.id === pickedId);
        if (pickedId !== null && !pickedNode) clearPick();
        const pickedArrival = selectedArrivalRef.current;
        if (pickedArrival !== null && !arrivalsRef.current.some((a) => a.id === pickedArrival)) {
          clearPick();
        }

        // What the Info panel reads. Counting the lines strung to the picked
        // node is a pass over the crowd, which is why it happens here with
        // everything else that only has to be right four times a second.
        if (!pickedNode) {
          setPicked((was) => (was === null ? was : null));
        } else {
          let links = 0;
          for (const other of nodes) {
            if (other === pickedNode) continue;
            if (Math.hypot(other.x - pickedNode.x, other.y - pickedNode.y) <= reach) links += 1;
          }
          const override = overridesRef.current[pickedNode.id];
          const vitals = pickedNode.vitals;
          setPicked({
            id: pickedNode.id,
            charId: pickedNode.charId,
            guy: pickedNode.guy,
            guys: guysRef.current?.count ?? 0,
            flip: pickedNode.flip,
            size: pickedNode.size,
            x: pickedNode.x,
            y: pickedNode.y,
            speed: Math.hypot(pickedNode.vx, pickedNode.vy),
            links,
            hp: vitals?.hp ?? 0,
            max: vitals?.max ?? 0,
            down: isDown(pickedNode),
            scrapped: Boolean(vitals),
            shape: override?.shape ?? shape,
            dressed: Boolean(override && (override.shape || override.color)),
          });
        }
        // The initiative order runs out in the draw loop; this is the panel's
        // button finding out about it.
        setLiningUp((was) => (was && !initiativeRef.current ? false : was));
        // They wander off on their own clock; this is the panel noticing.
        setVisiting((was) => (was === arrivalsRef.current.length ? was : arrivalsRef.current.length));
        // And this is the Goings-on panel reading the canvas. With nothing
        // going on and nobody to report on, the old account is handed back
        // rather than an identically empty new one.
        const account = goingsOn(arrivalsRef.current, nodes, rosterRef.current, now);
        setGoings((was) =>
          was.visits.length === 0 &&
          account.visits.length === 0 &&
          was.party.length === 0 &&
          account.party.length === 0
            ? was
            : account,
        );
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [clearPick]);

  const trackPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, on: true };
  };
  const dropPointer = () => {
    pointerRef.current = { ...pointerRef.current, on: false };
  };

  // Clicking the canvas picks whoever is under the pointer — their own size
  // decides how big a target they are — and clicking past everyone puts the
  // panels back to working on the whole crowd. Click a party member and their
  // sheet comes up in the Party panel, which is the only place they can
  // actually be changed. Whatever is picked, the Info panel describes it.
  //
  // Whoever has wandered in is looked at first: they are drawn over the top of
  // everybody and are the biggest thing on the canvas, so a click that lands on
  // one was meant for them and not for whoever is cowering underneath.
  const pickNode = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const arrival of arrivalsRef.current) {
      const radius = Math.max(16, arrivalSize(arrival) / 2 + 5);
      if (Math.hypot(arrival.x - x, arrival.y - y) > radius) continue;
      setSelectedId(null);
      setSelectedChar(null);
      setSelectedArrival(arrival.id);
      note(`picked the ${arrival.name}`);
      return;
    }

    let best: Node | null = null;
    let bestDistance = Infinity;
    for (const node of nodesRef.current.concat(partyRef.current)) {
      const distance = Math.hypot(node.x - x, node.y - y);
      const radius = Math.max(14, heightOf(node) / 2 + 5);
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    setSelectedId(best ? best.id : null);
    setSelectedChar(best?.charId ?? null);
    setSelectedArrival(null);
    const member = best?.charId ? party.roster.find((c) => c.id === best.charId) : undefined;
    if (member) party.select(member);
    if (member) note(`picked ${nameOf(member)}`);
    else if (best) note(`picked node #${best.id}`);
    else if (selectedId !== null) note("nothing picked");
  };

  // The other way round: a row in the Party panel rings that member on canvas.
  const pickCharacter = useCallback(
    (character: Character) => {
      party.select(character);
      const node = partyRef.current.find((n) => n.charId === character.id);
      setSelectedId(node?.id ?? null);
      setSelectedChar(node ? character.id : null);
      setSelectedArrival(null);
    },
    [party],
  );

  // A window closed mid-throw shouldn't leave a roll waiting to be read out.
  useEffect(() => {
    const pending = settling.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // The Console's own reporting. Everything above writes down what you did to
  // it; this is the window writing down what happened to it.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    note("party.webp ready");
  }, [note]);

  // Who was in the party last time the Console looked. Nobody is reported as
  // having left when the whole party goes — that gets its own line.
  const knownRef = useRef<Character[]>([]);
  useEffect(() => {
    const before = knownRef.current;
    knownRef.current = party.roster;
    for (const member of party.roster) {
      if (!before.some((c) => c.id === member.id)) note(`${nameOf(member)} joined the party`);
    }
    if (party.departing) return;
    for (const member of before) {
      if (!party.roster.some((c) => c.id === member.id)) note(`${nameOf(member)} left the party`);
    }
  }, [party.roster, party.departing, note]);

  useEffect(() => {
    if (!party.departing) return;
    const count = party.departing.members.length;
    note(`the party departed — ${count} ${count === 1 ? "adventurer" : "adventurers"} away`);
  }, [party.departing, note]);

  // When the party walks off, everyone sets out from wherever they were
  // standing, crosses the desktop behind the windows, and is gone.
  useEffect(() => {
    const departing = party.departing;
    if (!departing) {
      setWalk(null);
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    const spots: Record<string, { x: number; y: number }> = {};
    for (const member of departing.members) {
      const spot = partyPosRef.current.get(member.id);
      spots[member.id] =
        spot && rect
          ? { x: rect.left + spot.x, y: rect.top + spot.y }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    setWalk({ members: departing.members, spots });
  }, [party.departing]);

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 2,
        font: "13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <nav style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {PANELS.map((panel) => {
          const open = stack.includes(panel.id);
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => openPanel(panel.id)}
              aria-pressed={open}
              style={{
                appearance: "none",
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 13px",
                font: "inherit",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.01em",
                border: `1px solid ${open ? settings.accent : "rgba(15, 20, 30, 0.22)"}`,
                background: open ? settings.accent : "rgba(15, 20, 30, 0.05)",
                color: open ? "#0b0e14" : "#1b2130",
                transition: "background 120ms ease, border-color 120ms ease",
              }}
            >
              {panel.label}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(15, 20, 30, 0.5)" }}>
          {stack.length === 0 ? "no tools open" : `${stack.length} tool${stack.length > 1 ? "s" : ""} open`}
        </span>
      </nav>

      <div
        ref={wrapRef}
        onPointerMove={trackPointer}
        onPointerLeave={dropPointer}
        onPointerDown={pickNode}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          background: settings.surface,
          border: "1px solid rgba(15, 20, 30, 0.25)",
          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
          touchAction: "none",
          cursor: "crosshair",
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>

      {stack.map((id, index) => {
        const slot = PANELS.findIndex((p) => p.id === id);
        const panel = PANELS[slot];
        if (!panel) return null;
        return (
          <FloatingPanel
            key={id}
            title={panel.title}
            width={panel.width}
            initial={spots[id] ?? initialSpot(slot, panel.width)}
            stackIndex={index}
            onFocus={() => focusPanel(id)}
            onClose={() => closePanel(id)}
            dressed={dressPanels}
            lights={frame.lights}
            melt={frame.melt}
            onMoved={(at) => rememberSpot(id, at)}
          >
            {id === "palette" && (
              <>
                <Scope
                  selected={editable}
                  character={selectedCharacter}
                  visitor={
                    goings.visits.find((visit) => visit.id === selectedArrival)?.who ?? null
                  }
                  edited={edited}
                  onClear={clearPick}
                  onReset={resetSelected}
                  hasOverride={Boolean(selectedOverride && Object.keys(selectedOverride).length > 0)}
                />
                <Field label="Accent">
                  <div style={{ display: "flex", gap: 7 }}>
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent}
                        type="button"
                        aria-label={accent}
                        aria-pressed={activeAccent === accent}
                        onClick={() =>
                          editable ? editSelected({ color: accent }) : set("accent", accent)
                        }
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          cursor: "pointer",
                          background: accent,
                          border:
                            activeAccent === accent
                              ? "2px solid #fff"
                              : "2px solid rgba(255, 255, 255, 0.14)",
                        }}
                      />
                    ))}
                  </div>
                </Field>
                <Field label="Nodes">
                  <Segmented
                    options={[
                      { label: "Guys", value: "guys" },
                      { label: "🐀", value: "rat" },
                      { label: "🐁", value: "mouse" },
                      { label: "Dots", value: "dots" },
                    ]}
                    value={activeShape}
                    accent={settings.accent}
                    onChange={(value) =>
                      editable
                        ? editSelected({ shape: value as NodeShape })
                        : set("shape", value as NodeShape)
                    }
                  />
                </Field>
                <Field label="Surface">
                  <Segmented
                    options={SURFACES.map((s) => ({ label: s.label, value: s.value }))}
                    value={settings.surface}
                    accent={settings.accent}
                    onChange={(value) => set("surface", value)}
                  />
                </Field>
              </>
            )}

            {id === "motion" && (
              <>
                <Slider
                  label="Density"
                  value={settings.density}
                  min={10}
                  max={500}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => set("density", v)}
                />
                <Slider
                  label="Speed"
                  value={settings.speed}
                  min={0}
                  max={2}
                  step={0.05}
                  accent={settings.accent}
                  onChange={(v) => set("speed", v)}
                />
                <Slider
                  label="Reach"
                  value={settings.reach}
                  min={30}
                  max={260}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => set("reach", v)}
                />
                <Slider
                  label="Trails"
                  value={Math.round(settings.trails * 100)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => set("trails", v / 100)}
                />
                {/* Nothing to wipe until the canvas is holding on to something,
                    so with Trails down the button is dimmed rather than left
                    looking broken — the same as the Frame panel's lights. */}
                <button
                  type="button"
                  onClick={() => {
                    wipeRef.current = true;
                    note("canvas wiped");
                  }}
                  style={{ ...panelButton, opacity: settings.trails > 0 ? 1 : 0.4 }}
                >
                  Wipe clean
                </button>
              </>
            )}

            {id === "forces" && (
              <>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
                  Something for the crowd to push against.
                </p>
                <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
                  <Dial
                    label="Gravity"
                    value={forces.gravityAngle}
                    accent={settings.accent}
                    onChange={(degrees) => setForce("gravityAngle", degrees)}
                  />
                  <div style={{ flex: "1 1 auto", minWidth: 0, display: "grid", gap: 8 }}>
                    <Slider
                      label="Pull"
                      value={percent(forces.gravity)}
                      min={0}
                      max={100}
                      step={1}
                      accent={settings.accent}
                      onChange={(v) => setForce("gravity", v / 100)}
                    />
                    {/* Below nothing the wind blows the other way, so the
                        slider is filled from the middle out. */}
                    <Slider
                      label="Wind"
                      value={percent(forces.wind)}
                      min={-100}
                      max={100}
                      step={1}
                      accent={settings.accent}
                      onChange={(v) => setForce("wind", v / 100)}
                    />
                    <Slider
                      label="Jitter"
                      value={percent(forces.jitter)}
                      min={0}
                      max={100}
                      step={1}
                      accent={settings.accent}
                      onChange={(v) => setForce("jitter", v / 100)}
                    />
                  </div>
                </div>

                <Field label="Pointer">
                  <Segmented
                    options={[
                      { label: "Ignore", value: "ignore" },
                      { label: "Attract", value: "attract" },
                      { label: "Repel", value: "repel" },
                      { label: "Orbit", value: "orbit" },
                    ]}
                    value={forces.pointer}
                    accent={settings.accent}
                    onChange={(value) => setForce("pointer", value as PointerMode)}
                  />
                </Field>
                {/* With the pointer ignoring them there is nothing for this to
                    work on, so it is dimmed rather than left looking broken. */}
                <Group dim={forces.pointer === "ignore"}>
                  <Slider
                    label="Force"
                    value={percent(forces.pull)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForce("pull", v / 100)}
                  />
                </Group>

                <Group label="Flocking">
                  <Slider
                    label="Separation"
                    value={percent(forces.separation)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForce("separation", v / 100)}
                  />
                  <Slider
                    label="Alignment"
                    value={percent(forces.alignment)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForce("alignment", v / 100)}
                  />
                  <Slider
                    label="Cohesion"
                    value={percent(forces.cohesion)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForce("cohesion", v / 100)}
                  />
                </Group>
                <button
                  type="button"
                  onClick={() => {
                    note("forces let go");
                    setSettings((prev) => ({ ...prev, forces: NO_FORCES }));
                  }}
                  style={panelButton}
                >
                  Let them be
                </button>
              </>
            )}

            {id === "formation" && (
              <>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
                  Stop drifting and arrange.
                </p>
                <Field label="Shape">
                  <Segmented
                    options={[
                      { label: "⛓️‍💥", value: "drift" },
                      { label: "🧱", value: "grid" },
                      { label: "🔲", value: "square" },
                      { label: "🔘", value: "circle" },
                      { label: "🌘", value: "triangle" },
                    ]}
                    value={formation.shape}
                    accent={settings.accent}
                    onChange={(value) => setForm("shape", value as FormationShape)}
                  />
                </Field>
                <Group dim={formation.shape === "drift"}>
                  <Slider
                    label="Hold"
                    value={percent(formation.hold)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForm("hold", v / 100)}
                  />
                  {/* Up from nothing they keep breaking out of the shape and
                      walking back into it, rather than standing in it for good. */}
                  <Slider
                    label="Restless"
                    value={percent(formation.restless)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setForm("restless", v / 100)}
                  />
                </Group>
                <button
                  type="button"
                  onClick={() => {
                    note("formation broken up");
                    setSettings((prev) => ({ ...prev, formation: { ...prev.formation, shape: "drift" } }));
                  }}
                  style={{ ...panelButton, opacity: formation.shape === "drift" ? 0.4 : 1 }}
                >
                  Let them wander
                </button>
              </>
            )}

            {id === "links" && (
              <>
                <Slider
                  label="Opacity"
                  value={percent(links.opacity)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => setLink("opacity", v / 100)}
                />
                <Slider
                  label="Weight"
                  value={links.weight}
                  min={0.5}
                  max={4}
                  step={0.5}
                  accent={settings.accent}
                  format={(v) => v.toFixed(1)}
                  onChange={(v) => setLink("weight", v)}
                />
                {/* At the top of the slider the cap comes off entirely, which
                    is what the canvas did before there was one. */}
                <Slider
                  label="Per node"
                  value={links.max}
                  min={1}
                  max={LINK_ALL}
                  step={1}
                  accent={settings.accent}
                  format={(v) => (v === LINK_ALL ? "all" : String(v))}
                  onChange={(v) => setLink("max", v)}
                />
                <Slider
                  label="Curve"
                  value={percent(links.curve)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => setLink("curve", v / 100)}
                />
                <Field label="Colour">
                  <Segmented
                    options={[
                      { label: "Ink", value: "ink" },
                      { label: "Accent", value: "accent" },
                      { label: "Nodes", value: "nodes" },
                    ]}
                    value={links.colour}
                    accent={settings.accent}
                    onChange={(value) => setLink("colour", value as LinkColour)}
                  />
                </Field>
                <Slider
                  label="Mesh"
                  value={percent(links.mesh)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => setLink("mesh", v / 100)}
                />
                <button
                  type="button"
                  onClick={() => {
                    note("links back to plain");
                    setSettings((prev) => ({ ...prev, links: DEFAULT_LINKS }));
                  }}
                  style={panelButton}
                >
                  Plain lines
                </button>
              </>
            )}

            {id === "dice" && (
              <PartyDicePanel
                die={die}
                luck={luck}
                rolls={rolls}
                accent={settings.accent}
                party={party.roster.length}
                liningUp={liningUp}
                onDie={setDie}
                onLuck={setLuck}
                onRoll={roll}
                onInitiative={rollForInitiative}
              />
            )}

            {id === "encounters" && (
              <PartyEncountersPanel
                encounters={encounters}
                accent={settings.accent}
                visiting={visiting}
                party={party.roster.length}
                onRoll={rollAnEncounter}
                onClear={sendThemAway}
              />
            )}

            {id === "goings" && (
              <PartyGoingsPanel goings={goings} accent={settings.accent} />
            )}

            {id === "info" && (
              <PartyInfoPanel
                picked={picked}
                member={selectedCharacter}
                arrival={goings.visits.find((visit) => visit.id === selectedArrival) ?? null}
                accent={settings.accent}
              />
            )}

            {id === "console" && <PartyConsole log={log} accent={settings.accent} />}

            {id === "frame" && (
              <>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
                  Edit parent window frame.
                </p>
                {/* The frame already bends and lights the window it sits in.
                    This lets the crowd out through it. */}
                <Field label="Crowd">
                  <Segmented
                    options={[
                      { label: "Kept in", value: "in" },
                      { label: "Let out", value: "out" },
                    ]}
                    value={settings.loose ? "out" : "in"}
                    accent={settings.accent}
                    onChange={(value) => set("loose", value === "out")}
                  />
                </Field>
                <Field label="Tool windows">
                  <Segmented
                    options={[
                      { label: "Modern", value: "modern" },
                      { label: "Framed", value: "framed" },
                    ]}
                    value={dressPanels ? "framed" : "modern"}
                    accent={settings.accent}
                    onChange={(value) => setDressPanels(value === "framed")}
                  />
                </Field>
                <Slider
                  label="Warp"
                  value={Math.round(frame.melt * 100)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => onFrameChange({ melt: v / 100 })}
                />
                <button
                  type="button"
                  onClick={() => onFrameChange({ melt: 0 })}
                  style={panelButton}
                >
                  Straighten up
                </button>

                {/* Colour is the master switch — with it down the other three
                    have nothing to work on, so they are dimmed rather than
                    left looking broken. */}
                <Slider
                  label="Colour"
                  value={Math.round(frame.lights.colour * 100)}
                  min={0}
                  max={100}
                  step={1}
                  accent={settings.accent}
                  onChange={(v) => setLights({ colour: v / 100 })}
                />
                <div style={{ display: "grid", gap: 7, opacity: frame.lights.colour > 0 ? 1 : 0.4 }}>
                  <Slider
                    label="Cycle"
                    value={Math.round(frame.lights.cycle * 100)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setLights({ cycle: v / 100 })}
                  />
                  <Slider
                    label="Pulse"
                    value={Math.round(frame.lights.pulse * 100)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setLights({ pulse: v / 100 })}
                  />
                  <Slider
                    label="Strobe"
                    value={Math.round(frame.lights.strobe * 100)}
                    min={0}
                    max={100}
                    step={1}
                    accent={settings.accent}
                    onChange={(v) => setLights({ strobe: v / 100 })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onFrameChange({ lights: NO_LIGHTS })}
                  style={panelButton}
                >
                  Lights out
                </button>
              </>
            )}

            {id === "party" && (
              <PartyPanel party={party} accent={settings.accent} onPick={pickCharacter} />
            )}

            {id === "readout" && (
              <div style={{ display: "grid", gap: 7 }}>
                <Stat label="Frames" value={`${stats.fps}/s`} accent={settings.accent} />
                <Stat label="Nodes" value={`${stats.nodes}`} accent={settings.accent} />
                <Stat label="Pointer" value={`${stats.x}, ${stats.y}`} accent={settings.accent} />
                <Stat
                  label="Picked"
                  value={
                    selectedArrival !== null
                      ? (goings.visits.find((visit) => visit.id === selectedArrival)?.who ?? "gone")
                      : selectedCharacter
                        ? `${selectedCharacter.name} · ${selectedCharacter.cls}`
                        : selectedId === null
                          ? "none"
                          : `#${selectedId} · ${SHAPE_NAMES[activeShape]}`
                  }
                  accent={settings.accent}
                />
                <Stat label="Party" value={`${party.roster.length}`} accent={settings.accent} />
                <Stat label="Edited" value={`${edited}`} accent={settings.accent} />
              </div>
            )}
          </FloatingPanel>
        );
      })}

      {typeof document !== "undefined" &&
        createPortal(
          <canvas
            ref={looseRef}
            aria-hidden
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              // Between the desktop and the windows, the same place the party
              // walks out through, so the crowd wanders behind everything that
              // is open rather than over the top of it.
              zIndex: 5,
              pointerEvents: "none",
            }}
          />,
          document.body,
        )}

      {walk &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden
            style={{
              position: "fixed",
              inset: 0,
              // Between the desktop and the windows, so they file out from
              // behind the frame they were drifting in.
              zIndex: 5,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <style>{`
              @keyframes party-walk-right { from { transform: translateX(0); } to { transform: translateX(100vw); } }
              @keyframes party-walk-left { from { transform: translateX(0) scaleX(-1); } to { transform: translateX(-100vw) scaleX(-1); } }
              @keyframes party-bob { from { transform: translateY(0); } to { transform: translateY(-3px); } }
            `}</style>
            {walk.members.map((c, i) => {
              const spot = walk.spots[c.id];
              const goesRight = i % 2 === 0;
              return (
                <div
                  key={c.id}
                  style={{
                    position: "absolute",
                    left: spot.x - 24,
                    top: spot.y - 24,
                    animation: `${goesRight ? "party-walk-right" : "party-walk-left"} ${WALK_MS}ms linear ${i * WALK_STAGGER_MS}ms both`,
                  }}
                >
                  <div style={{ animation: "party-bob 160ms steps(1) infinite alternate" }}>
                    <DndPortrait character={c} size={48} tint={settings.accent} />
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

// How far down the desktop the next panel's slot sits, and how far left the
// next column of them starts once a column has run out of screen.
const SLOT_DOWN = 132;
const SLOT_ACROSS = 290;

// Each panel has its own slot down the right edge of the desktop, so opening two
// at once never lands one on top of the other — and once a column of slots
// reaches the taskbar the next one starts a column to its left, rather than
// going on off the bottom of the screen. This is only where a panel that has
// never been dragged opens: once it has been moved, the window remembers the
// spot and gives it back on every reopen.
function initialSpot(slot: number, width: number) {
  if (typeof window === "undefined") return { x: 420, y: 96 };
  const perColumn = Math.max(1, Math.floor((window.innerHeight - 150) / SLOT_DOWN));
  return {
    x: Math.max(16, window.innerWidth - width - 24 - Math.floor(slot / perColumn) * SLOT_ACROSS),
    y: 66 + (slot % perColumn) * SLOT_DOWN,
  };
}

/**
 * What the Palette is pointed at: the whole crowd, or the one node that was
 * clicked. Without saying so, a palette that suddenly only recolours one figure
 * reads as broken.
 */
function Scope({
  selected,
  character,
  visitor,
  edited,
  hasOverride,
  onClear,
  onReset,
}: {
  selected: boolean;
  character: Character | null;
  /** What has wandered in, when that is what was clicked — the Palette's one blind spot. */
  visitor: string | null;
  edited: number;
  hasOverride: boolean;
  onClear: () => void;
  onReset: () => void;
}) {
  const pill: React.CSSProperties = {
    cursor: "pointer",
    borderRadius: 7,
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "#e8ecf4",
    font: "inherit",
    fontSize: 11,
    padding: "4px 9px",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        flexWrap: "wrap",
        padding: "8px 9px",
        borderRadius: 9,
        background: "rgba(255, 255, 255, 0.05)",
        fontSize: 12,
        color: "rgba(232, 236, 244, 0.7)",
      }}
    >
      <span style={{ flex: "1 1 auto" }}>
        {visitor
          ? `the ${visitor} is picked — the Palette does not dress what wanders in`
          : character
            ? `${character.name} is on the sheet — the Party panel dresses them`
            : selected
              ? "Selected node in edit"
              : "Select a node to edit"}
        {!selected && !character && !visitor && edited > 0 ? ` · ${edited} edited` : ""}
      </span>
      {selected && hasOverride && (
        <button type="button" style={pill} onClick={onReset}>
          Reset
        </button>
      )}
      {(selected || character || visitor) && (
        <button type="button" style={pill} onClick={onClear}>
          Done
        </button>
      )}
    </div>
  );
}
