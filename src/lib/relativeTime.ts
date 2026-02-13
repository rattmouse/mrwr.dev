function plural(value: number, unit: string): string {
  return `${value}${unit}`;
}

export function formatRelativeCompact(input: Date | string, now = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) return "unknown";

  const deltaMs = date.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);
  const future = deltaMs > 0;

  const second = 1000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  let value: number;
  let unit: string;

  if (absMs < minute) {
    value = Math.max(1, Math.round(absMs / second));
    unit = "s";
  } else if (absMs < hour) {
    value = Math.round(absMs / minute);
    unit = "m";
  } else if (absMs < day) {
    value = Math.round(absMs / hour);
    unit = "h";
  } else if (absMs < 14 * day) {
    value = Math.round(absMs / day);
    unit = "d";
  } else if (absMs < 8 * week) {
    value = Math.round(absMs / week);
    unit = "w";
  } else if (absMs < 24 * month) {
    value = Math.round(absMs / month);
    unit = "mo";
  } else {
    value = Math.round(absMs / year);
    unit = "y";
  }

  const compact = plural(Math.max(1, value), unit);
  return future ? `in ${compact}` : `${compact} ago`;
}

export function replaceIsoDateTimesWithRelative(text: string, now = new Date()): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (stamp) =>
    formatRelativeCompact(stamp, now)
  );
}
