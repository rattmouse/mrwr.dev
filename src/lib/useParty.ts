"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPART_MS,
  WALK_MS,
  WALK_STAGGER_MS,
  formatCountdown,
  freshCharacter,
  loadParty,
  randomName,
  rollAllScores,
  sameCharacter,
  saveParty,
  type Ability,
  type Character,
} from "@/lib/dnd";

export type Party = {
  /** Everyone who has been saved, in the order they joined. */
  roster: Character[];
  /** The sheet on screen — a party member, or someone not yet saved. */
  draft: Character;
  /** Party members with edits waiting for them, by id. */
  stash: Record<string, Character>;
  /** A new, never-saved character set aside while a member is on the sheet. */
  pending: Character | null;
  /** Whether the sheet's character is in the roster, and whether it differs. */
  saved: boolean;
  dirty: boolean;
  /** "4:12" while a party is standing around, null when there is none. */
  countdown: string | null;
  /** True after a party has left and nobody new has joined yet. */
  departed: boolean;
  /** Who is mid-walk-off. A fresh object each departure, null when nobody is. */
  departing: { members: Character[] } | null;

  patch: (changes: Partial<Character>) => void;
  setScore: (ability: Ability, value: number) => void;
  select: (c: Character) => void;
  newCharacter: () => void;
  rollScores: () => void;
  save: () => void;
  remove: () => void;
  depart: () => void;
};

/**
 * A pocket character roster: roll up an adventurer, tweak the sheet, and Save to
 * add them to the party. It lives in localStorage — nothing leaves the browser —
 * and it only lives ten minutes, then everyone walks off.
 */
export function useParty(): Party {
  const [roster, setRoster] = useState<Character[]>([]);
  const [draft, setDraft] = useState<Character>(() => freshCharacter());
  // Unsaved edits to party members who aren't on the sheet right now, by id,
  // so clicking between characters never throws work away.
  const [stash, setStash] = useState<Record<string, Character>>({});
  const [pending, setPending] = useState<Character | null>(null);
  const [loaded, setLoaded] = useState(false);
  // When the current party walks off, or null while there is no party.
  const [departsAt, setDepartsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [departing, setDeparting] = useState<{ members: Character[] } | null>(null);
  const [departed, setDeparted] = useState(false);

  // localStorage is browser-only; read it after mount so SSR and the first
  // client render agree. A party whose time ran out while the tab was closed
  // has simply gone.
  useEffect(() => {
    const stored = loadParty();
    if (stored.departsAt !== null && Date.now() >= stored.departsAt) {
      setRoster([]);
      setDepartsAt(null);
      setDeparted(stored.members.length > 0);
    } else {
      setRoster(stored.members);
      setDepartsAt(stored.departsAt);
      if (stored.members.length > 0) setDraft(stored.members[0]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveParty({ members: roster, departsAt });
  }, [roster, departsAt, loaded]);

  // The clock starts when a party forms and stops when it's gone.
  useEffect(() => {
    if (!loaded) return;
    if (roster.length === 0) setDepartsAt(null);
    else setDepartsAt((prev) => prev ?? Date.now() + DEPART_MS);
  }, [roster.length, loaded]);

  // Tick once a second while there's a party, for the countdown and to notice
  // when it's time to go.
  useEffect(() => {
    if (departsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [departsAt]);

  // Everyone files out, and the roster empties behind them.
  const depart = useCallback(() => {
    if (roster.length === 0) return;
    setDeparting({ members: roster });
    setRoster([]);
    setStash({});
    setDeparted(true);
  }, [roster]);

  useEffect(() => {
    if (departsAt === null || now < departsAt) return;
    depart();
  }, [now, departsAt, depart]);

  // Clear the walkers once the last one is off screen.
  useEffect(() => {
    if (!departing) return;
    const total = WALK_MS + departing.members.length * WALK_STAGGER_MS + 500;
    const timer = window.setTimeout(() => setDeparting(null), total);
    return () => window.clearTimeout(timer);
  }, [departing]);

  const savedTwin = roster.find((c) => c.id === draft.id);
  const saved = savedTwin !== undefined;
  const dirty = savedTwin === undefined || !sameCharacter(savedTwin, draft);

  const patch = useCallback((changes: Partial<Character>) => {
    setDraft((prev) => ({ ...prev, ...changes }));
  }, []);

  const setScore = useCallback((ability: Ability, value: number) => {
    const clamped = Math.max(1, Math.min(30, Math.round(value)));
    setDraft((prev) => ({ ...prev, scores: { ...prev.scores, [ability]: clamped } }));
  }, []);

  // Put someone else on the sheet, setting the current sheet's edits aside
  // (and picking up any that were set aside for them).
  const select = useCallback(
    (c: Character) => {
      if (c.id === draft.id) return;
      const fromPending = pending?.id === c.id;
      if (!saved) setPending(draft);
      else if (fromPending) setPending(null);
      setStash((prev) => {
        const next = { ...prev };
        if (saved && dirty) next[draft.id] = draft;
        delete next[c.id];
        return next;
      });
      setDraft(fromPending ? c : (stash[c.id] ?? c));
    },
    [draft, pending, saved, dirty, stash],
  );

  const newCharacter = useCallback(() => {
    if (saved && dirty) setStash((prev) => ({ ...prev, [draft.id]: draft }));
    setPending(null);
    setDraft(freshCharacter());
  }, [draft, saved, dirty]);

  const rollScores = useCallback(() => {
    setDraft((prev) => ({ ...prev, scores: rollAllScores() }));
  }, []);

  const save = useCallback(() => {
    const trimmed = { ...draft, name: draft.name.trim() || randomName() };
    setRoster((members) => {
      const idx = members.findIndex((c) => c.id === trimmed.id);
      if (idx === -1) return [...members, trimmed];
      const next = members.slice();
      next[idx] = trimmed;
      return next;
    });
    setDraft(trimmed);
    setDeparted(false);
  }, [draft]);

  const remove = useCallback(() => {
    const idx = roster.findIndex((c) => c.id === draft.id);
    if (idx === -1) return;
    const next = roster.filter((c) => c.id !== draft.id);
    const neighbour = next[Math.min(idx, next.length - 1)];
    setRoster(next);
    if (neighbour) {
      setDraft(stash[neighbour.id] ?? neighbour);
      setStash((prev) => {
        const rest = { ...prev };
        delete rest[draft.id];
        delete rest[neighbour.id];
        return rest;
      });
    } else {
      setDraft(pending ?? freshCharacter());
      setPending(null);
      setStash({});
    }
  }, [draft, roster, stash, pending]);

  const countdown =
    departsAt !== null && roster.length > 0 ? formatCountdown(departsAt - now) : null;

  return useMemo(
    () => ({
      roster,
      draft,
      stash,
      pending,
      saved,
      dirty,
      countdown,
      departed,
      departing,
      patch,
      setScore,
      select,
      newCharacter,
      rollScores,
      save,
      remove,
      depart,
    }),
    [
      roster,
      draft,
      stash,
      pending,
      saved,
      dirty,
      countdown,
      departed,
      departing,
      patch,
      setScore,
      select,
      newCharacter,
      rollScores,
      save,
      remove,
      depart,
    ],
  );
}
