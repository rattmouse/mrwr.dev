/**
 * Where the sun is over Seattle at a given day and hour, for trees.exe's Sun
 * light: the low-precision almanac formulas (good to about a hundredth of a
 * degree this century — far finer than a 16 m terrain cell can show), and
 * Seattle's clocks, daylight saving and all, so the hour on the slider is the
 * hour on a Seattle wall.
 */

const RAD = Math.PI / 180;

/** The middle of the city. */
export const SEATTLE = { lat: 47.615, lon: -122.33 };

export type SunPosition = {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon; negative once it has set. */
  altitude: number;
};

export function sunPosition(at: Date, lat = SEATTLE.lat, lon = SEATTLE.lon): SunPosition {
  const n = at.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = 18.697374558 + 24.06570982441908 * n;
  // The hour angle: how far past due south it is, west positive.
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { azimuth: ((azimuth / RAD) % 360 + 360) % 360, altitude: altitude / RAD };
}

/** The n-th Sunday of a month (n 1-based), as a day of the month. */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

/**
 * The instant it is `minutes` past midnight on Seattle's clocks on day `day`
 * (0-based) of `year`: Pacific time, an hour forward from the second Sunday in
 * March to the first Sunday in November.
 */
export function seattleInstant(year: number, day: number, minutes: number): Date {
  const local = Date.UTC(year, 0, 1 + day) + minutes * 60000;
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 2);
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 2);
  const offset = local >= start && local < end ? 7 : 8;
  return new Date(local + offset * 3600000);
}

/** The minutes past midnight it is in Seattle right now. */
export function seattleMinutesNow(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 2 + 8);
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 2 + 7);
  const offset = now.getTime() >= start && now.getTime() < end ? 7 : 8;
  const local = new Date(now.getTime() - offset * 3600000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Sunrise and sunset on Seattle's clocks, in minutes past midnight; null in the (impossible here) polar case. */
export function sunTimes(year: number, day: number): { rise: number; set: number } | null {
  // The upper limb on the horizon, refraction allowed for.
  const H0 = -0.833;
  const alt = (m: number) => sunPosition(seattleInstant(year, day, m)).altitude - H0;
  const cross = (lo: number, hi: number) => {
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (alt(lo) * alt(mid) <= 0) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  let rise: number | null = null;
  let set: number | null = null;
  for (let m = 0; m < 1440; m += 30) {
    const a = alt(m);
    const b = alt(m + 30);
    if (a < 0 && b >= 0) rise = cross(m, m + 30);
    if (a >= 0 && b < 0) set = cross(m, m + 30);
  }
  return rise === null || set === null ? null : { rise, set };
}

export function clockLabel(minutes: number): string {
  const m = Math.round(minutes) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The light the Tilt view is drawn in: a unit vector to the sun (x east, y
 * north, z up), and how bright the day is — 1 in full sun, falling through
 * twilight to a moonlit floor.
 */
export type Light = { x: number; y: number; z: number; day: number; altitude: number; azimuth: number };

export function lightFrom(sun: SunPosition): Light {
  const az = sun.azimuth * RAD;
  // Below the horizon the shading still comes from where it set or will rise, from just above it.
  const alt = Math.max(2, sun.altitude) * RAD;
  const day = Math.max(0, Math.min(1, (sun.altitude + 6) / 12));
  return {
    x: Math.sin(az) * Math.cos(alt),
    y: Math.cos(az) * Math.cos(alt),
    z: Math.sin(alt),
    day,
    altitude: sun.altitude,
    azimuth: sun.azimuth,
  };
}
