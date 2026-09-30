/**
 * A program's settings as they were left, so closing it, refreshing, or coming
 * back another day picks up where it stopped. Each program keeps one object
 * under its own key and says what goes in it by handing over its defaults.
 *
 * Reading goes by the defaults' shape: a stored field only comes back if it is
 * the same kind of thing the default is, and anything missing or wrong falls
 * back to the default. So a save from before a setting existed, or after one
 * changed type, still loads — just without the parts that no longer fit. Which
 * of several strings is allowed is the caller's to check; `oneOf` is for that.
 *
 * These programs only ever mount in the browser — the page is prerendered with
 * just the welcome window — so the save can be read straight into their first
 * state, with no flash of the defaults.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameKind(fallback: unknown, stored: unknown): boolean {
  if (typeof fallback === "number") return typeof stored === "number" && Number.isFinite(stored);
  return typeof stored === typeof fallback;
}

function mergeOnto<T>(fallback: T, stored: unknown): T {
  if (isPlainObject(fallback)) {
    if (!isPlainObject(stored)) return fallback;
    const out: Record<string, unknown> = { ...fallback };
    for (const key of Object.keys(fallback)) {
      if (key in stored) out[key] = mergeOnto(fallback[key], stored[key]);
    }
    return out as T;
  }
  if (Array.isArray(fallback)) {
    // Arrays here are fixed rows of one kind of thing (eight knobs, say), so a
    // stored one only counts if it is the same length and every entry fits.
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return (stored.every((v, i) => sameKind(fallback[i], v)) ? stored : fallback) as T;
  }
  return (sameKind(fallback, stored) ? stored : fallback) as T;
}

export function loadSettings<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    return mergeOnto(defaults, JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function saveSettings(key: string, settings: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Private mode or quota — the settings just don't outlive the tab.
  }
}

/** `value` if it is one of `allowed`, otherwise `fallback`. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A `#rrggbb` colour, which is all the colour pickers here ever write. */
export function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
