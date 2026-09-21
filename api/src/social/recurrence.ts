/**
 * When a scheduled job runs, written as a cron expression read in Colombo time.
 *
 * Five fields, the ones every crontab has: minute, hour, day of the month, month, day of the week.
 * Each takes `*`, a number, a list (`1,15`), a range (`1-5`), or a step (`*\/2`, `1-5/2`). Sunday is
 * both 0 and 7, as it is everywhere else. Seconds are not a field: the scheduler wakes once a
 * minute, so a minute is the smallest thing worth writing.
 *
 * The expression is matched against the wall clock in Asia/Colombo, not UTC, because that is the
 * time the owner sets and the reader lives in. An expression is stored as written — no timezone
 * arithmetic at rest, which would make "half past seven" drift if the offset ever changed.
 */

export const cronFieldCount = 5;

/** The bounds of each field, in order. Day of the week takes 7 for Sunday as well as 0. */
const bounds: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

const names: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** The numbers one field allows, or null when the field cannot be read. */
function fieldValues(text: string, index: number): Set<number> | null {
  const limit = bounds[index]!;
  const allowed = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    if (stepText !== undefined && !/^\d+$/u.test(stepText)) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = limit.min;
      to = limit.max;
    } else {
      const ends = (range ?? "").split("-");
      if (ends.length > 2) return null;
      const first = readNumber(ends[0]);
      if (first === null) return null;
      from = first;
      if (ends.length === 2) {
        const second = readNumber(ends[1]);
        if (second === null) return null;
        to = second;
      } else to = stepText === undefined ? first : limit.max;
    }
    if (from < limit.min || to > limit.max || from > to) return null;
    for (let value = from; value <= to; value += step) allowed.add(index === 4 && value === 7 ? 0 : value);
  }
  return allowed.size ? allowed : null;
}

function readNumber(text: string | undefined): number | null {
  if (!text) return null;
  const named = names[text.toLowerCase()];
  if (named !== undefined) return named;
  return /^\d+$/u.test(text) ? Number(text) : null;
}

export type CronFields = { minute: Set<number>; hour: Set<number>; day: Set<number>; month: Set<number>; weekday: Set<number>; dayRestricted: boolean; weekdayRestricted: boolean };

/** The expression as sets of allowed numbers, or null when it cannot be read. */
export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().toLowerCase().split(/\s+/u);
  if (parts.length !== cronFieldCount) return null;
  const parsed = parts.map((part, index) => fieldValues(part, index));
  if (parsed.some((set) => set === null)) return null;
  const [minute, hour, day, month, weekday] = parsed as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  return { minute, hour, day, month, weekday, dayRestricted: parts[2] !== "*", weekdayRestricted: parts[4] !== "*" };
}

export const isCron = (value: unknown): value is string => typeof value === "string" && parseCron(value) !== null;

/** A wall clock reading, as the matcher wants it. */
export type ClockParts = { minute: number; hour: number; day: number; month: number; weekday: number };

/** The parts of a moment in a zone; Colombo unless another is given. */
export function clockParts(at: Date, zone = "Asia/Colombo"): ClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(read("minute")),
    // Midnight comes back as 24 in some runtimes; the crontab calls it 0.
    hour: Number(read("hour")) % 24,
    day: Number(read("day")),
    month: Number(read("month")),
    weekday: weekdays[read("weekday")] ?? 0,
  };
}

/**
 * Whether the expression fires at this minute. When both the day of the month and the day of the
 * week are restricted, either one matching is enough — the rule every crontab follows, so
 * "1 * * 1" means the first of the month and every Monday, not the first Monday.
 */
export function cronMatches(expression: string, at: Date, zone?: string): boolean {
  const fields = parseCron(expression);
  if (!fields) return false;
  const now = clockParts(at, zone);
  if (!fields.minute.has(now.minute) || !fields.hour.has(now.hour) || !fields.month.has(now.month)) return false;
  const dayHit = fields.day.has(now.day);
  const weekdayHit = fields.weekday.has(now.weekday);
  if (fields.dayRestricted && fields.weekdayRestricted) return dayHit || weekdayHit;
  if (fields.dayRestricted) return dayHit;
  if (fields.weekdayRestricted) return weekdayHit;
  return true;
}

/** The next minute at or after `from` that the expression fires, within a year; null when it never does. */
export function nextRun(expression: string, from: Date, zone?: string): Date | null {
  if (!parseCron(expression)) return null;
  const start = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let minutes = 0; minutes < 366 * 24 * 60; minutes += 1) {
    const at = new Date(start.getTime() + minutes * 60_000);
    if (cronMatches(expression, at, zone)) return at;
  }
  return null;
}

/**
 * The last minute at or before `from` that the expression fired, within `withinMinutes`; null when
 * it did not fire in that window. What a scheduler needs to know whether it owes a run it missed.
 */
export function previousRun(expression: string, from: Date, withinMinutes = 24 * 60, zone?: string): Date | null {
  if (!parseCron(expression)) return null;
  const start = new Date(Math.floor(from.getTime() / 60_000) * 60_000);
  for (let minutes = 0; minutes <= withinMinutes; minutes += 1) {
    const at = new Date(start.getTime() - minutes * 60_000);
    if (cronMatches(expression, at, zone)) return at;
  }
  return null;
}

// --- Saying it in words ------------------------------------------------------------------------

const weekdayWords = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (hour: number, minute: number): string => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const list = (values: string[]): string => (values.length <= 1 ? (values[0] ?? "") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`);
const ordinal = (value: number): string => {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
};

/**
 * The expression in the owner's words: "Every day at 07:30", "Every Monday at 09:00", "Every hour".
 * Anything the plain wordings do not cover is given back as the expression itself, which is still
 * true and still readable.
 */
export function describeCron(expression: string): string {
  const fields = parseCron(expression);
  if (!fields) return "Never";
  const parts = expression.trim().split(/\s+/u);
  const [minuteText, hourText, dayText, monthText, weekdayText] = parts as [string, string, string, string, string];
  const minutes = [...fields.minute].sort((a, b) => a - b);
  const hours = [...fields.hour].sort((a, b) => a - b);
  const everyMonth = monthText === "*";
  const oneMinute = minutes.length === 1;
  const times = oneMinute && hours.length <= 4 ? list(hours.map((hour) => clock(hour, minutes[0]!))) : "";

  if (minuteText === "*" && hourText === "*") return "Every minute";
  if (oneMinute && hourText === "*" && dayText === "*" && weekdayText === "*" && everyMonth) {
    return minutes[0] === 0 ? "Every hour, on the hour" : `Every hour, at ${minutes[0]} minutes past`;
  }
  if (oneMinute && /^\*\/\d+$/u.test(hourText) && dayText === "*" && weekdayText === "*" && everyMonth) {
    return `Every ${hourText.slice(2)} hours, at ${String(minutes[0]).padStart(2, "0")} minutes past`;
  }
  if (times && dayText === "*" && weekdayText === "*" && everyMonth) return `Every day at ${times}`;
  if (times && dayText === "*" && weekdayText !== "*" && everyMonth) {
    const days = [...fields.weekday].sort((a, b) => a - b).map((day) => weekdayWords[day]!);
    return `Every ${list(days)} at ${times}`;
  }
  if (times && weekdayText === "*" && dayText !== "*" && everyMonth) {
    const days = [...fields.day].sort((a, b) => a - b).map(ordinal);
    return `On the ${list(days)} of the month at ${times}`;
  }
  return `Cron: ${expression.trim()}`;
}

// --- The shapes the admin offers ---------------------------------------------------------------

export type RecurrenceForm =
  | { kind: "hourly"; minute: number }
  | { kind: "every_n_hours"; hours: number; minute: number }
  | { kind: "daily"; at: string }
  | { kind: "weekly"; at: string; weekdays: number[] }
  | { kind: "monthly"; at: string; days: number[] }
  | { kind: "cron"; expression: string };

const clockOf = (at: string): { hour: number; minute: number } => {
  const [hour, minute] = at.split(":");
  return { hour: Number(hour), minute: Number(minute) };
};

/** A shape the admin offers, as the expression that is stored. */
export function cronFromForm(form: RecurrenceForm): string {
  switch (form.kind) {
    case "hourly":
      return `${form.minute} * * * *`;
    case "every_n_hours":
      return `${form.minute} */${form.hours} * * *`;
    case "daily": {
      const { hour, minute } = clockOf(form.at);
      return `${minute} ${hour} * * *`;
    }
    case "weekly": {
      const { hour, minute } = clockOf(form.at);
      return `${minute} ${hour} * * ${[...form.weekdays].sort((a, b) => a - b).join(",") || "1"}`;
    }
    case "monthly": {
      const { hour, minute } = clockOf(form.at);
      return `${minute} ${hour} ${[...form.days].sort((a, b) => a - b).join(",") || "1"} * *`;
    }
    case "cron":
      return form.expression.trim();
  }
}
