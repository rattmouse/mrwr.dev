import { PROGRAMS, WINDOW_IDS, type ProgramDef, type WindowId } from "@/components/windows/programs";

/**
 * Which windows a search box query most likely means, best first. Each word
 * of the query is held up against a window's title, its Start menu label,
 * its `search` words and its bash.exe blurb; a word that is the whole of one
 * of those counts most, the start of one less, and anywhere inside the blurb
 * least. Windows nothing matched are left out.
 */
export function likelyWindows(query: string, limit = 3): WindowId[] {
  const words = tokens(query);
  if (words.length === 0) return [];

  const scored: { id: WindowId; score: number }[] = [];
  for (const id of WINDOW_IDS) {
    const score = scoreWindow(PROGRAMS[id], id, words);
    if (score > 0) scored.push({ id, score });
  }
  // Stable, so a tie keeps PROGRAMS' order — the Start menu's.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}

// Too common to say anything about which window a blurb is for.
const BLURB_STOPWORDS = new Set(["that", "this", "what", "with", "have", "from", "your", "into", "just", "like", "every", "ever", "used", "whatever"]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreWindow(def: ProgramDef, id: WindowId, words: string[]): number {
  // Names: the id, the title split at its dot ("paint.exe" → "paint", "exe"
  // is dropped), the menu label and the hand-picked search words.
  const names = new Set<string>([
    ...tokens(id),
    ...tokens(def.title).filter((t) => t !== "exe" && t !== "txt" && t !== "webp" && t !== "cc"),
    ...tokens(def.menu?.label ?? ""),
    ...(def.search ?? []),
  ]);
  const blurb = tokens(def.shell?.blurb ?? "");

  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const name of names) {
      if (name === word) best = Math.max(best, 10);
      // Three letters is enough to be typing a name; fewer and nearly every
      // window matches, and the past searches would never get a look in.
      else if (word.length >= 3 && name.startsWith(word)) best = Math.max(best, 6);
      else if (word.length >= 4 && word.startsWith(name) && name.length >= 3) best = Math.max(best, 4);
    }
    if (best === 0 && word.length >= 4 && !BLURB_STOPWORDS.has(word) && blurb.some((b) => b.startsWith(word))) best = 2;
    total += best;
  }
  return total;
}
